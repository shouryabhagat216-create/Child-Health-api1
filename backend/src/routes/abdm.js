const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const mockScenario = require('../middleware/mockScenario');
const { MOCK_NOTICE, SCENARIOS } = require('../abdm/constants');
const {
  childParamsSchema,
  consentParamsSchema,
  verifyAbhaSchema,
  linkConfirmSchema,
  consentRequestSchema,
} = require('../abdm/schemas');

// Every reply is labelled so nobody can mistake this for the real ABDM.
const reply = (res, status, data) =>
  res.status(status).set('X-ABDM-Mode', 'MOCK').json({ mock: true, notice: MOCK_NOTICE, ...data });

function abdmRouter({ abdmService, auditService }) {
  const router = express.Router();
  router.use(mockScenario); // optional X-Mock-Scenario header

  // Runs a handler and writes one audit event for it, whether it succeeds or fails.
  // Only ids and an error code are recorded - never the request body, ABHA number, OTP or records.
  // (Requests rejected earlier by validation never reach this point and are not audited.)
  const audited = (eventType, status, handler) =>
    asyncHandler(async (req, res) => {
      const base = {
        requestId: req.id,
        eventType,
        actorGuardianId: req.guardian.id,
        childId: req.params.childId,
        consentId: req.params.consentId,
      };
      let result;
      try {
        result = await handler(req);
      } catch (err) {
        await auditService.recordSafely({
          ...base,
          childId: base.childId || (await auditService.childIdForConsent(base.consentId)),
          outcome: err.status === 401 || err.status === 403 ? 'DENIED' : 'FAILURE',
          reasonCode: err.code || 'INTERNAL_ERROR',
        });
        throw err;
      }
      await auditService.record({
        ...base,
        childId: base.childId || (await auditService.childIdForConsent(base.consentId)),
        outcome: 'SUCCESS',
      });
      return reply(res, status, result);
    });

  const read = (handler, status = 200) => asyncHandler(async (req, res) => reply(res, status, await handler(req)));

  router.get('/mock-scenarios', read(async () => ({ scenarios: SCENARIOS })));

  // ---- M1: ABHA ----
  router.get(
    '/children/:childId/abha/sample',
    validate('params', childParamsSchema),
    read((req) => abdmService.sampleAbha(req.params.childId, req.guardian.id))
  );
  router.post(
    '/children/:childId/abha/verify',
    validate('params', childParamsSchema),
    validate('body', verifyAbhaSchema),
    audited('ABHA_VERIFY', 200, (req) =>
      abdmService.verifyAbha(req.params.childId, req.guardian.id, req.body, req.mockScenario)
    )
  );
  router.get(
    '/children/:childId/abha',
    validate('params', childParamsSchema),
    read((req) => abdmService.getAbha(req.params.childId, req.guardian.id))
  );

  // ---- M2 (HIP): care-context linking ----
  router.get(
    '/children/:childId/care-contexts',
    validate('params', childParamsSchema),
    read((req) => abdmService.listCareContexts(req.params.childId, req.guardian.id))
  );
  router.post(
    '/children/:childId/care-contexts/link-init',
    validate('params', childParamsSchema),
    audited('CARE_CONTEXT_LINK_INIT', 200, (req) =>
      abdmService.linkInit(req.params.childId, req.guardian.id, req.mockScenario)
    )
  );
  router.post(
    '/children/:childId/care-contexts/link-confirm',
    validate('params', childParamsSchema),
    validate('body', linkConfirmSchema),
    audited('CARE_CONTEXT_LINK_CONFIRM', 201, (req) =>
      abdmService.linkConfirm(req.params.childId, req.guardian.id, req.body, req.mockScenario)
    )
  );

  // ---- Consent lifecycle (the request simulates a Health Information User) ----
  router.post(
    '/children/:childId/consents',
    validate('params', childParamsSchema),
    validate('body', consentRequestSchema),
    audited('CONSENT_REQUEST', 201, (req) =>
      abdmService.requestConsent(req.params.childId, req.guardian.id, req.body, req.mockScenario)
    )
  );
  router.get(
    '/children/:childId/consents',
    validate('params', childParamsSchema),
    read((req) => abdmService.listConsents(req.params.childId, req.guardian.id))
  );
  router.get(
    '/consents/:consentId',
    validate('params', consentParamsSchema),
    read((req) => abdmService.getConsent(req.params.consentId, req.guardian.id))
  );
  for (const action of ['approve', 'deny', 'revoke']) {
    router.post(
      `/consents/:consentId/${action}`,
      validate('params', consentParamsSchema),
      audited(`CONSENT_${action.toUpperCase()}`, 200, (req) =>
        abdmService.decideConsent(req.params.consentId, req.guardian.id, action, req.mockScenario)
      )
    );
  }

  // ---- Health information transfer (consent-gated) and audit trail ----
  router.post(
    '/consents/:consentId/health-information',
    validate('params', consentParamsSchema),
    audited('HEALTH_INFORMATION_FETCH', 200, (req) =>
      abdmService.fetchHealthInformation(req.params.consentId, req.guardian.id, req.mockScenario)
    )
  );
  router.get(
    '/children/:childId/audit',
    validate('params', childParamsSchema),
    read((req) => auditService.listForChild(req.params.childId, req.guardian.id))
  );

  return router;
}

module.exports = { abdmRouter };
