const { AppError } = require('../errors');
const { findOwnedChild } = require('./ownership');
const { createMemoryStore } = require('../state/stateStore');

const TXN_TTL_MS = 10 * 60 * 1000;
const RESEND_AFTER_MS = 60 * 1000;
const MAX_RESENDS = 2;

// M1 "Create ABHA by Aadhaar OTP" against the real sandbox. The Aadhaar number and the OTP exist only
// as arguments of these calls: they are encrypted by the provider and never stored, logged or
// returned. Pending transactions and the user tokens ABDM returns live in the shared state store (encrypted in
// the database) and the tokens are never sent to the browser.
// ABDM sometimes returns the mobile number whole (it echoes the one we linked). Responses from this API
// only ever carry the last four digits.
const maskMobile = (m) => (typeof m === 'string' && m.length >= 4 ? `******${m.slice(-4)}` : m);

const NS = 'abha-txn';

function createAbhaService({ repo, provider, store = createMemoryStore(), now = () => new Date() }) {
  // txnId -> { kind, guardianId, childId, resends, lastSentAt, expiresAt, tokens }
  const save = (txnId, txn) => store.put(NS, txnId, txn, { ttlMs: Math.max(1000, txn.expiresAt - now().getTime()) });

  const requireSandbox = () => {
    if (!provider || provider.mode !== 'sandbox') {
      throw new AppError(409, 'SANDBOX_NOT_ENABLED', 'Set ABDM_MODE=sandbox (with sandbox credentials) in .env and restart');
    }
  };

  const ownedTxn = async (txnId, guardianId, childId, kind) => {
    const txn = await store.get(NS, txnId);
    if (!txn || (kind && txn.kind !== kind) || txn.guardianId !== guardianId || txn.childId !== childId || txn.expiresAt <= now().getTime()) {
      await store.del(NS, txnId);
      throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Unknown or expired ABHA transaction; start again');
    }
    return txn;
  };

  // The user token comes from the creation step and never leaves the server.
  const withUserToken = async (txnId, guardianId, childId) => {
    const txn = await ownedTxn(txnId, guardianId, childId); // a create or a login transaction
    if (!txn.tokens || !txn.tokens.token) {
      throw new AppError(409, 'ABHA_NOT_CREATED', 'Verify the Aadhaar OTP before this step');
    }
    return txn;
  };

  return {
    // Sends the Aadhaar OTP. Pass txnId to resend: reuses the transaction, waits 60 s between sends and
    // allows 2 resends at most (CRT_ABHA_106).
    async requestCreateOtp(childId, guardianId, { aadhaar, txnId }) {
      await findOwnedChild(repo, childId, guardianId);
      requireSandbox();
      let txn;
      if (txnId) {
        txn = await ownedTxn(txnId, guardianId, childId);
        if (txn.resends >= MAX_RESENDS) {
          throw new AppError(429, 'OTP_RESEND_LIMIT', 'Maximum OTP resend attempts reached. Please try again after 30 mins');
        }
        const wait = txn.lastSentAt + RESEND_AFTER_MS - now().getTime();
        if (wait > 0) {
          throw new AppError(429, 'OTP_RESEND_TOO_SOON', `Wait ${Math.ceil(wait / 1000)} seconds before resending`);
        }
      }
      const sent = await provider.requestAadhaarOtp({ aadhaar, txnId });
      const current = txn || { kind: 'create', guardianId, childId, resends: 0, expiresAt: now().getTime() + TXN_TTL_MS, tokens: null };
      if (txn) current.resends += 1;
      current.lastSentAt = now().getTime();
      await save(sent.txnId, current);
      return { txnId: sent.txnId, message: sent.message, resendsLeft: MAX_RESENDS - current.resends, abdmRequestId: sent.requestId };
    },

    // Verifies the OTP. A wrong OTP keeps the transaction so the person can try again. isNew false (the
    // Aadhaar already holds an ABHA) is a success, not an error.
    async verifyCreateOtp(childId, guardianId, { txnId, otp, mobile }) {
      await findOwnedChild(repo, childId, guardianId);
      requireSandbox();
      const txn = await ownedTxn(txnId, guardianId, childId, 'create');
      const res = await provider.enrolByAadhaar({ txnId, otp, mobile });
      const profile = res.ABHAProfile || {};
      txn.tokens = res.tokens || null; // server side only
      txn.abdmTxnId = res.txnId || txnId;
      await save(txnId, txn);
      return {
        isNew: res.isNew,
        message: res.message,
        abdmRequestId: res.requestId,
        // Everything the screens need, minus the photograph and the tokens.
        profile: {
          abhaNumber: profile.ABHANumber,
          abhaAddresses: profile.phrAddress,
          firstName: profile.firstName,
          middleName: profile.middleName,
          lastName: profile.lastName,
          dob: profile.dob,
          gender: profile.gender,
          mobile: maskMobile(profile.mobile),
          stateName: profile.stateName,
          districtName: profile.districtName,
          abhaStatus: profile.abhaStatus,
        },
      };
    },

    // VRFY_ABHA_101 / 201: log in with an ABHA number. method is 'aadhaar' (OTP to the Aadhaar-linked
    // phone) or 'mobile' (OTP to the ABHA-linked phone). Only the ABDM-1114 refusal means nobody holds
    // this ABHA; it is passed on as ABDM returned it and the journey must not create on any other refusal.
    async requestLoginOtp(childId, guardianId, { abhaNumber, method }) {
      await findOwnedChild(repo, childId, guardianId);
      requireSandbox();
      const sent = await provider.requestLoginOtp({ abhaNumber, method });
      await save(sent.txnId, { kind: 'login', method, guardianId, childId, expiresAt: now().getTime() + TXN_TTL_MS, tokens: null });
      return { txnId: sent.txnId, message: sent.message, abdmRequestId: sent.requestId };
    },

    // A wrong OTP keeps the transaction so the person can enter it again.
    async verifyLoginOtp(childId, guardianId, { txnId, otp }) {
      await findOwnedChild(repo, childId, guardianId);
      requireSandbox();
      const txn = await ownedTxn(txnId, guardianId, childId, 'login');
      const res = await provider.verifyLoginOtp({ txnId, otp, method: txn.method });
      // A verification that returns a refreshToken already returned the final user token. One without it
      // would be a short-lived token that needs an exchange this slice does not implement: refuse
      // instead of guessing.
      if (!res.token || !res.refreshToken) {
        throw new AppError(502, 'ABDM_UNEXPECTED_LOGIN_RESPONSE', 'The login response did not carry a user token', { abdmRequestId: res.requestId });
      }
      txn.tokens = { token: res.token, refreshToken: res.refreshToken }; // server side only
      await save(txnId, txn);
      const accounts = (res.accounts || []).map((a) => ({
        abhaNumber: a.ABHANumber,
        abhaAddress: a.preferredAbhaAddress,
        name: a.name,
        status: a.status,
        gender: a.gender,
        dob: a.dob,
        kycVerified: a.kycVerified,
      }));
      return { authResult: res.authResult, message: res.message, accounts, abdmRequestId: res.requestId };
    },

    // CRT_ABHA_112: at least three suggestions, then the chosen (or own) address. The same transaction
    // also works for an Aadhaar that already holds an ABHA (isNew false): one person can have several.
    async suggestAddresses(childId, guardianId, { txnId }) {
      await findOwnedChild(repo, childId, guardianId);
      requireSandbox();
      await withUserToken(txnId, guardianId, childId);
      const res = await provider.suggestAddresses({ txnId });
      return { addresses: res.abhaAddressList, abdmRequestId: res.requestId };
    },

    async createAddress(childId, guardianId, { txnId, abhaAddress }) {
      await findOwnedChild(repo, childId, guardianId);
      requireSandbox();
      await withUserToken(txnId, guardianId, childId);
      const res = await provider.createAddress({ txnId, abhaAddress: abhaAddress.replace(/@.*$/, '') });
      return { abhaNumber: res.healthIdNumber, abhaAddress: res.preferredAbhaAddress, abdmRequestId: res.requestId };
    },

    // CRT_ABHA_113: the 14-digit number and the address with the profile, fetched fresh from ABDM.
    async getProfile(childId, guardianId, { txnId }) {
      await findOwnedChild(repo, childId, guardianId);
      requireSandbox();
      const txn = await withUserToken(txnId, guardianId, childId);
      const p = await provider.getProfile({ xToken: txn.tokens.token });
      return {
        profile: {
          abhaNumber: p.ABHANumber,
          abhaAddress: p.preferredAbhaAddress,
          firstName: p.firstName,
          middleName: p.middleName,
          lastName: p.lastName,
          dob: [p.dayOfBirth, p.monthOfBirth, p.yearOfBirth].every(Boolean) ? `${p.dayOfBirth}-${p.monthOfBirth}-${p.yearOfBirth}` : undefined,
          gender: p.gender,
          mobile: maskMobile(p.mobile),
          stateName: p.stateName,
          districtName: p.districtName,
          kycVerified: p.kycVerified,
        },
        abdmRequestId: p.requestId,
      };
    },

    // CRT_ABHA_114: the card image exactly as ABDM returned it.
    async getCard(childId, guardianId, { txnId }) {
      await findOwnedChild(repo, childId, guardianId);
      requireSandbox();
      const txn = await withUserToken(txnId, guardianId, childId);
      return provider.getCard({ xToken: txn.tokens.token });
    },
  };
}

module.exports = { createAbhaService };
