const { randomUUID } = require('crypto');
const { AppError, NotFoundError, ForbiddenError, ValidationError } = require('../errors');
const { findOwnedChild } = require('./ownership');
const { MOCK_OTP, CONSENT_STATUS: S } = require('../abdm/constants');
const { toImmunizationBundle } = require('../fhir/mapper');
const { syntheticAbhaFor, maskAbha, syntheticAbhaAddress } = require('../abdm/syntheticAbha');

const MAX_OTP_ATTEMPTS = 3;
const LINK_TRANSACTION_TTL_MS = 10 * 60 * 1000;
const CARE_CONTEXT_REFERENCE = 'immunization-record';

const DAY_MS = 24 * 60 * 60 * 1000;

// MOCK ABDM logic: ABHA verification, care-context linking and the consent lifecycle.
// Every operation first proves the child belongs to the logged-in guardian (findOwnedChild),
// then runs through the mock gateway, which can simulate failures (see mockGateway.js).
function createAbdmService({ repo, gateway, config, now = () => new Date() }) {
  // Pending link transactions live in memory. They are short-lived (10 minutes) and are lost on a
  // restart; a real system would keep them in a shared store such as Redis or a database table.
  const linkTransactions = new Map();

  // The stored status can say GRANTED although the consent has since expired, so the status shown
  // to callers is always worked out from the expiry time at the moment of the request.
  const effectiveStatus = (consent) =>
    (consent.status === S.REQUESTED || consent.status === S.GRANTED) && new Date(consent.expiresAt) <= now()
      ? S.EXPIRED
      : consent.status;
  const view = (consent) => ({ ...consent, status: effectiveStatus(consent) });

  const requireAbha = async (childId) => {
    const link = await repo.findAbhaLinkByChildId(childId);
    if (!link) {
      // Out-of-sequence call, like ABDM-2406 in the official docs.
      throw new AppError(409, 'ABHA_NOT_VERIFIED', 'Verify the child\'s ABHA before this step');
    }
    return link;
  };

  // A consent belongs to a child; a consent of someone else's child looks like it does not exist.
  const findOwnedConsent = async (consentId, guardianId) => {
    const consent = await repo.findConsentById(consentId);
    if (!consent) throw new NotFoundError('CONSENT_NOT_FOUND', `Consent '${consentId}' does not exist`);
    try {
      await findOwnedChild(repo, consent.childId, guardianId);
    } catch {
      throw new NotFoundError('CONSENT_NOT_FOUND', `Consent '${consentId}' does not exist`);
    }
    return consent;
  };

  return {
    // ---------- M1: ABHA ----------
    async sampleAbha(childId, guardianId) {
      await findOwnedChild(repo, childId, guardianId);
      return { abhaNumber: syntheticAbhaFor(childId), mockOtp: MOCK_OTP };
    },

    async verifyAbha(childId, guardianId, { abhaNumber, otp }, scenario) {
      await findOwnedChild(repo, childId, guardianId);
      return gateway.execute(scenario, 'abha.verify', async () => {
        if (otp !== MOCK_OTP) throw new ValidationError('The OTP is incorrect', [{ field: 'otp', message: 'is incorrect' }]);
        if (abhaNumber !== syntheticAbhaFor(childId)) {
          throw new NotFoundError('ABHA_NOT_FOUND', 'No such ABHA in the mock registry for this child');
        }
        const link = await repo.upsertAbhaLink({
          id: randomUUID(),
          childId,
          abhaNumberMasked: maskAbha(abhaNumber), // the full number is never stored
          abhaAddress: syntheticAbhaAddress(childId),
          verifiedAt: now().toISOString(),
        });
        return { abha: link };
      });
    },

    async getAbha(childId, guardianId) {
      await findOwnedChild(repo, childId, guardianId);
      const link = await repo.findAbhaLinkByChildId(childId);
      return { abha: link };
    },

    // ---------- M2 (HIP side): care-context linking ----------
    async listCareContexts(childId, guardianId) {
      await findOwnedChild(repo, childId, guardianId);
      return { careContexts: await repo.listCareContextsByChild(childId) };
    },

    async linkInit(childId, guardianId, scenario) {
      await findOwnedChild(repo, childId, guardianId);
      return gateway.execute(scenario, 'careContext.linkInit', async () => {
        await requireAbha(childId);
        const existing = await repo.listCareContextsByChild(childId);
        if (existing.some((c) => c.reference === CARE_CONTEXT_REFERENCE)) {
          throw new AppError(409, 'CARE_CONTEXT_ALREADY_LINKED', 'This care context is already linked (modelled on ABDM-1056)');
        }
        const transactionId = randomUUID();
        const expiresAt = new Date(now().getTime() + LINK_TRANSACTION_TTL_MS);
        linkTransactions.set(transactionId, { childId, guardianId, attempts: 0, expiresAt });
        // Mirrors the documented init reply: auth type DIRECT, medium, hint and expiry.
        return { transactionId, authType: 'DIRECT', medium: 'MOBILE_OTP', hint: 'mock mobile', expiresAt: expiresAt.toISOString() };
      });
    },

    async linkConfirm(childId, guardianId, { transactionId, otp }, scenario) {
      await findOwnedChild(repo, childId, guardianId);
      return gateway.execute(scenario, 'careContext.linkConfirm', async () => {
        const txn = linkTransactions.get(transactionId);
        if (!txn || txn.childId !== childId || txn.guardianId !== guardianId || txn.expiresAt <= now()) {
          linkTransactions.delete(transactionId);
          throw new NotFoundError('TRANSACTION_NOT_FOUND', 'Unknown or expired link transaction; start again');
        }
        if (otp !== MOCK_OTP) {
          txn.attempts += 1;
          // Bounded attempts: after 3 wrong codes the transaction is dead.
          if (txn.attempts >= MAX_OTP_ATTEMPTS) {
            linkTransactions.delete(transactionId);
            throw new AppError(400, 'TOO_MANY_OTP_ATTEMPTS', 'Too many wrong OTPs; start linking again');
          }
          throw new ValidationError('The OTP is incorrect', [
            { field: 'otp', message: `is incorrect (${MAX_OTP_ATTEMPTS - txn.attempts} attempts left)` },
          ]);
        }
        linkTransactions.delete(transactionId);
        const careContext = await repo.insertCareContext({
          id: randomUUID(),
          childId,
          reference: CARE_CONTEXT_REFERENCE,
          display: 'Immunisation record (MOCK)',
          linkedAt: now().toISOString(),
        });
        return { careContext };
      });
    },

    // ---------- M3 (HIU side, simulated) and consent lifecycle ----------
    async requestConsent(childId, guardianId, input, scenario) {
      await findOwnedChild(repo, childId, guardianId);
      return gateway.execute(scenario, 'consent.request', async () => {
        await requireAbha(childId);
        const today = now().toISOString().slice(0, 10);
        if (input.dateFrom > input.dateTo || input.dateTo > today) {
          throw new ValidationError('Request validation failed', [
            { field: 'dateTo', message: 'dateFrom must not be after dateTo, and dateTo must not be in the future' },
          ]);
        }
        const expiresAt = input.expiresAt
          ? new Date(input.expiresAt)
          : new Date(now().getTime() + config.abdm.consentDefaultDays * DAY_MS);
        const latest = new Date(now().getTime() + config.abdm.consentMaxDays * DAY_MS);
        if (expiresAt <= now() || expiresAt > latest) {
          throw new ValidationError('Request validation failed', [
            { field: 'expiresAt', message: `must be in the future and within ${config.abdm.consentMaxDays} days` },
          ]);
        }
        const consent = await repo.insertConsent({
          id: randomUUID(),
          childId,
          requesterName: input.requesterName,
          purpose: input.purpose,
          hiTypes: input.hiTypes,
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          expiresAt: expiresAt.toISOString(),
          status: S.REQUESTED,
          decidedAt: null,
          revokedAt: null,
          createdAt: now().toISOString(),
        });
        return { consent: view(consent) };
      });
    },

    async listConsents(childId, guardianId) {
      await findOwnedChild(repo, childId, guardianId);
      return { consents: (await repo.listConsentsByChild(childId)).map(view) };
    },

    async getConsent(consentId, guardianId) {
      return { consent: view(await findOwnedConsent(consentId, guardianId)) };
    },

    // action: 'approve' | 'deny' | 'revoke'. Only the guardian who owns the child can decide.
    // Repeating a decision that already happened is a harmless no-op (idempotent), because the real
    // gateway can deliver the same callback more than once.
    async decideConsent(consentId, guardianId, action, scenario) {
      await findOwnedConsent(consentId, guardianId);
      return gateway.execute(
        scenario,
        `consent.${action}`,
        async () => {
          // Re-read inside the operation so a repeated call sees the latest state.
          const current = await findOwnedConsent(consentId, guardianId);
          const status = effectiveStatus(current);
          const rule = {
            approve: { from: S.REQUESTED, to: S.GRANTED },
            deny: { from: S.REQUESTED, to: S.DENIED },
            revoke: { from: S.GRANTED, to: S.REVOKED },
          }[action];

          if (status === rule.to) return { consent: view(current), changed: false };
          if (status === S.EXPIRED) throw new ForbiddenError('CONSENT_EXPIRED', 'This consent has expired');
          if (status !== rule.from) {
            throw new AppError(409, 'INVALID_CONSENT_TRANSITION', `Cannot ${action} a consent that is ${status}`);
          }
          const stamp = now().toISOString();
          const updated = await repo.updateConsent(consentId, {
            status: rule.to,
            decidedAt: action === 'revoke' ? null : stamp,
            revokedAt: action === 'revoke' ? stamp : null,
          });
          return { consent: view(updated), changed: true };
        },
        { idempotent: true }
      );
    },

    // M2 (HIP side) data transfer, simulated: a consented requester fetches the child's
    // immunisation records as a FHIR Bundle. In the real flow the HIP pushes ENCRYPTED pages to the
    // requester's data-push URL; the mock returns the bundle directly and does NOT encrypt it.
    async fetchHealthInformation(consentId, guardianId, scenario) {
      const owned = await findOwnedConsent(consentId, guardianId);
      return gateway.execute(
        scenario,
        'healthInformation.fetch',
        async () => {
          // 1. The live consent status is checked on every call, so a revocation applies at once.
          const consent = await this.assertConsentUsable(consentId, owned.childId);
          const child = await findOwnedChild(repo, owned.childId, guardianId);
          // 2. The guardian's consent to WombTo18 processing must also be 'granted' before
          //    anything is shared outside. (Reminders only block 'revoked'; sharing is stricter.)
          if (child.consentStatus !== 'granted') {
            throw new ForbiddenError('CONSENT_REVOKED', 'The guardian has not granted consent to share this child\'s data');
          }
          if (!consent.hiTypes.includes('ImmunizationRecord')) {
            throw new ForbiddenError('CONSENT_NOT_GRANTED', 'Consent does not cover ImmunizationRecord');
          }
          const abha = await requireAbha(child.id);
          if (!(await repo.listCareContextsByChild(child.id)).length) {
            throw new AppError(409, 'CARE_CONTEXT_NOT_LINKED', 'Link the care context before sharing records');
          }
          // 3. Data minimisation: only completed vaccinations inside the consented date range.
          const immunizations = (await repo.listRemindersByChild(child.id)).filter(
            (r) => r.reminderStatus === 'completed' && r.dueDate >= consent.dateFrom && r.dueDate <= consent.dateTo
          );
          const bundle = toImmunizationBundle({
            child,
            abhaNumberMasked: abha.abhaNumberMasked,
            immunizations,
            now: now(),
          });
          return {
            transactionId: randomUUID(),
            consentId,
            encrypted: false,
            recordCount: immunizations.length,
            bundle,
          };
        },
        { idempotent: true }
      );
    },

    // Used by the health-information fetch. Reads the live status every time, so a
    // revocation blocks access immediately - there is no cached "granted" anywhere.
    async assertConsentUsable(consentId, childId) {
      const consent = await repo.findConsentById(consentId);
      if (!consent || consent.childId !== childId || effectiveStatus(consent) !== S.GRANTED) {
        throw new ForbiddenError('CONSENT_NOT_GRANTED', 'Consent is not granted: revoked, expired or never given (modelled on ABDM-1062)');
      }
      return consent;
    },
  };
}

module.exports = { createAbdmService };
