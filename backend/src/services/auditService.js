const { randomUUID } = require('crypto');
const { findOwnedChild } = require('./ownership');

// Records WHO did WHAT to WHICH child/consent, WHEN and with what outcome.
// It only stores ids and a short reason code. It must never receive ABHA numbers, OTPs, tokens
// or health data, so callers pass references, not payloads.
function createAuditService({ repo, now = () => new Date() }) {
  const build = (e) => ({
    id: randomUUID(),
    requestId: e.requestId || null,
    eventType: e.eventType,
    actorGuardianId: e.actorGuardianId,
    childId: e.childId || null,
    consentId: e.consentId || null,
    outcome: e.outcome,
    reasonCode: e.reasonCode || null,
    createdAt: now().toISOString(),
  });

  return {
    // Used on the success path. If the audit write fails, the request fails too, so data is
    // never released without a record of it.
    record: (event) => repo.insertAuditEvent(build(event)),

    // Used on the failure path: the original error matters more, so a failing audit write is
    // only reported on the server console and never replaces it.
    async recordSafely(event) {
      try {
        await repo.insertAuditEvent(build(event));
      } catch (err) {
        console.error(JSON.stringify({ level: 'error', message: 'audit write failed', name: err.name }));
      }
    },

    // Failed consent actions only carry a consent id in the URL; look up its child so the
    // event can still be filed under that child. Never throws.
    async childIdForConsent(consentId) {
      if (!consentId) return null;
      try {
        const consent = await repo.findConsentById(consentId);
        return consent ? consent.childId : null;
      } catch {
        return null;
      }
    },

    // A guardian sees only their own actions on their own child.
    async listForChild(childId, guardianId) {
      await findOwnedChild(repo, childId, guardianId);
      return { events: await repo.listAuditEvents(childId, guardianId) };
    },
  };
}

module.exports = { createAuditService };
