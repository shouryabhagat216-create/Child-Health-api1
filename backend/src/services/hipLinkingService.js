const { randomUUID, randomInt, randomBytes, createHash, timingSafeEqual } = require('crypto');
const { AppError } = require('../errors');
const { findOwnedChild } = require('./ownership');

const CARE_CONTEXT_REFERENCE = 'immunization-record';
const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000; // the link token is valid for six months
const LINK_OTP_TTL_MS = 10 * 60 * 1000;
const MAX_LINK_OTP_ATTEMPTS = 3;
const hashOtp = (salt, otp) => createHash('sha256').update(salt).update(otp).digest();

// M2 as a HIP, "HIP initiated linking": request a link token for the patient (the child's ABHA address), receive
// it on our bridge, then link the care context with it. The token is a secret: it is kept in server memory
// (lost on restart) per child, never returned by the API, never logged, never put in the audit trail.
// A 202 from ABDM only means receipt; the outcome is whatever the callback says.
function createHipLinkingService({ repo, hipClient, pending, facilities, now = () => new Date() }) {
  const state = new Map(); // childId -> { linkToken, tokenExpiresAt, tokenStatus, linkStatus, error }
  const addressToChild = new Map(); // ABHA address the guardian gave -> childId (memory only; persist before production)
  const pendingLinks = new Map(); // linkRefNumber -> { childId, salt, hash, attempts, expiresAt, plain }
  const get = (childId) => {
    if (!state.has(childId)) state.set(childId, { tokenStatus: 'NONE', linkStatus: 'NONE', error: null });
    return state.get(childId);
  };

  const requireReady = () => {
    if (!hipClient) throw new AppError(409, 'SANDBOX_NOT_ENABLED', 'Set ABDM_MODE=sandbox (with sandbox credentials) in .env and restart');
    const hipId = facilities().find((f) => (f.type || 'HIP') === 'HIP');
    if (!hipId) throw new AppError(409, 'NO_HIP_FACILITY', 'No HIP facility is configured: add one to the facilities file (a registered facility id linked to the bridge)');
    return hipId.serviceId;
  };

  const patientEntry = async (child) => {
    const careContexts = [{ referenceNumber: CARE_CONTEXT_REFERENCE, display: 'Immunisation record' }];
    // count must equal the number of care contexts in the entry (ABDM-1037 otherwise), not the number of vaccines
    return { referenceNumber: child.id, display: child.name, careContexts, hiType: 'ImmunizationRecord', count: careContexts.length };
  };

  return {
    async requestLinkToken(childId, guardianId, { abhaAddress, gender }) {
      const child = await findOwnedChild(repo, childId, guardianId);
      const hipId = requireReady();
      const requestId = randomUUID();
      pending.add(requestId, { kind: 'link-token', childId, abhaAddress });
      try {
        await hipClient.generateLinkToken({
          requestId,
          hipId,
          body: { abhaAddress, name: child.name, gender, yearOfBirth: Number(child.dateOfBirth.slice(0, 4)) },
        });
      } catch (err) {
        pending.take(requestId); // nothing is waiting for this call
        throw err;
      }
      addressToChild.set(abhaAddress.toLowerCase(), childId);
      const s = get(childId);
      s.tokenStatus = 'WAITING_FOR_CALLBACK';
      s.error = null;
      return { requestId, tokenStatus: s.tokenStatus };
    },

    async linkCareContext(childId, guardianId, { abhaAddress }) {
      const child = await findOwnedChild(repo, childId, guardianId);
      const hipId = requireReady();
      const s = get(childId);
      if (!s.linkToken || s.tokenExpiresAt <= now().getTime()) {
        throw new AppError(409, 'LINK_TOKEN_MISSING', 'Request a link token first and wait for it to arrive (it is valid for six months)');
      }
      const requestId = randomUUID();
      pending.add(requestId, { kind: 'link', childId });
      try {
        await hipClient.linkCareContext({
          requestId,
          hipId,
          linkToken: s.linkToken,
          body: {
            abhaAddress,
            patient: [await patientEntry(child)],
          },
        });
      } catch (err) {
        pending.take(requestId);
        throw err;
      }
      s.linkStatus = 'WAITING_FOR_CALLBACK';
      s.error = null;
      return { requestId, linkStatus: s.linkStatus };
    },

    async status(childId, guardianId) {
      await findOwnedChild(repo, childId, guardianId);
      const s = get(childId);
      return { tokenStatus: s.tokenStatus, linkStatus: s.linkStatus, error: s.error };
    },


    // The guardian says which ABHA address belongs to this child, so a patient search from a PHR app can find
    // the child. Needed for user-initiated linking, where no link token is requested first.
    async registerAddress(childId, guardianId, { abhaAddress }) {
      await findOwnedChild(repo, childId, guardianId);
      addressToChild.set(abhaAddress.toLowerCase(), childId);
      return { registered: true };
    },

    // ---- user-initiated linking, called by the bridge ----
    // A match needs the registered ABHA address AND the same name and year of birth, and the guardian's consent to
    // WombTo18 processing must be 'granted'. Only an unlinked care context is offered.
    async discover(body) {
      const p = body.patient || {};
      const ids = [p.id, ...(p.verifiedIdentifiers || []).filter((i) => i.type === 'ABHA_ADDRESS').map((i) => i.value)];
      const childId = ids.map((i) => addressToChild.get(String(i || '').toLowerCase())).find(Boolean);
      const child = childId && (await repo.findChildById(childId));
      const sameName = child && String(p.name || '').trim().toLowerCase() === child.name.trim().toLowerCase();
      const sameYear = child && Number(p.yearOfBirth) === Number(child.dateOfBirth.slice(0, 4));
      if (!child || !sameName || !sameYear || child.consentStatus !== 'granted' || get(child.id).linkStatus === 'LINKED') return null;
      return { matchedBy: ['ABHA_ADDRESS'], patient: [await patientEntry(child)] };
    },

    // Generates the link reference and a one-time code. There is no SMS channel here, so the code is held for the
    // guardian to read once (readLinkOtp); only a salted hash is kept for checking. Returns { error } to refuse.
    async initLink(body) {
      const childId = addressToChild.get(String(body.abhaAddress || '').toLowerCase());
      const child = childId && (await repo.findChildById(childId));
      if (!child || child.consentStatus !== 'granted') return { error: { code: 'ABDM-9999', message: 'No record found to link for this patient' } };
      if (get(child.id).linkStatus === 'LINKED') return { error: { code: 'ABDM-1056', message: 'This care context has already been linked' } };
      const asked = (body.patient || []).flatMap((x) => (x.careContexts || []).map((c) => c.referenceNumber));
      if (!asked.length || asked.some((r) => r !== CARE_CONTEXT_REFERENCE)) return { error: { code: 'ABDM-9999', message: 'Unknown care context' } };
      const linkRefNumber = randomUUID();
      const otp = String(randomInt(0, 1000000)).padStart(6, '0');
      const salt = randomBytes(16);
      const expiresAt = now().getTime() + LINK_OTP_TTL_MS;
      pendingLinks.set(linkRefNumber, { childId: child.id, salt, hash: hashOtp(salt, otp), attempts: 0, expiresAt, plain: otp });
      return { linkRefNumber, expiresAt: new Date(expiresAt).toISOString() };
    },

    // The owning guardian reads the code once, to tell it to the patient. Never logged or audited.
    async readLinkOtp(childId, guardianId) {
      await findOwnedChild(repo, childId, guardianId);
      const found = [...pendingLinks.entries()].reverse().find(([, e]) => e.childId === childId && e.plain && e.expiresAt > now().getTime());
      if (!found) throw new AppError(404, 'NO_PENDING_LINK_CODE', 'There is no link code waiting, or it was already read or has expired');
      const [linkRefNumber, entry] = found;
      const otp = entry.plain;
      entry.plain = null;
      return { linkRefNumber, otp, expiresAt: new Date(entry.expiresAt).toISOString() };
    },

    // Checks the code the patient entered. Three wrong codes end the link attempt.
    async confirmLink({ linkRefNumber, token }) {
      const entry = pendingLinks.get(linkRefNumber);
      if (!entry || entry.expiresAt <= now().getTime()) {
        pendingLinks.delete(linkRefNumber);
        return { error: { code: 'ABDM-1056', message: 'Invalid Link Reference Number' } };
      }
      const given = hashOtp(entry.salt, String(token).padStart(6, '0'));
      if (!timingSafeEqual(given, entry.hash)) {
        entry.attempts += 1;
        if (entry.attempts >= MAX_LINK_OTP_ATTEMPTS) pendingLinks.delete(linkRefNumber);
        return { error: { code: 'ABDM-9999', message: 'The code is incorrect or has expired' } };
      }
      pendingLinks.delete(linkRefNumber);
      const child = await repo.findChildById(entry.childId);
      get(child.id).linkStatus = 'LINKED';
      return { patient: [await patientEntry(child)] };
    },

    // ---- called by the bridge when ABDM answers ----
    onLinkToken(entry, body) {
      const s = get(entry.childId);
      if (body.error) {
        s.tokenStatus = 'FAILED';
        s.error = { code: body.error.code, message: body.error.message };
      } else if (typeof body.linkToken === 'string' && body.linkToken) {
        s.linkToken = body.linkToken;
        s.tokenExpiresAt = now().getTime() + SIX_MONTHS_MS;
        s.tokenStatus = 'RECEIVED';
        s.error = null;
      } else {
        s.tokenStatus = 'FAILED';
        s.error = { code: 'NO_TOKEN', message: 'The callback carried no link token' };
      }
    },
    onCareContextLinked(entry, body) {
      const s = get(entry.childId);
      if (body.error) {
        s.linkStatus = 'FAILED';
        s.error = { code: body.error.code, message: body.error.message };
      } else if (body.status === 'Successfully Linked care context') {
        s.linkStatus = 'LINKED';
        s.error = null;
      } else {
        s.linkStatus = 'FAILED';
        s.error = { code: 'LINK_NOT_CONFIRMED', message: String(body.status || 'unknown').slice(0, 100) };
      }
    },
  };
}

module.exports = { createHipLinkingService };
