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

function abdmRouter({ abdmService }) {
  const router = express.Router();
  router.use(mockScenario); // optional X-Mock-Scenario header

  router.get('/mock-scenarios', (req, res) => reply(res, 200, { scenarios: SCENARIOS }));

  // ---- M1: ABHA ----
  router.get(
    '/children/:childId/abha/sample',
    validate('params', childParamsSchema),
    asyncHandler(async (req, res) =>
      reply(res, 200, await abdmService.sampleAbha(req.params.childId, req.guardian.id))
    )
  );
  router.post(
    '/children/:childId/abha/verify',
    validate('params', childParamsSchema),
    validate('body', verifyAbhaSchema),
    asyncHandler(async (req, res) =>
      reply(res, 200, await abdmService.verifyAbha(req.params.childId, req.guardian.id, req.body, req.mockScenario))
    )
  );
  router.get(
    '/children/:childId/abha',
    validate('params', childParamsSchema),
    asyncHandler(async (req, res) => reply(res, 200, await abdmService.getAbha(req.params.childId, req.guardian.id)))
  );

  // ---- M2 (HIP): care-context linking ----
  router.get(
    '/children/:childId/care-contexts',
    validate('params', childParamsSchema),
    asyncHandler(async (req, res) =>
      reply(res, 200, await abdmService.listCareContexts(req.params.childId, req.guardian.id))
    )
  );
  router.post(
    '/children/:childId/care-contexts/link-init',
    validate('params', childParamsSchema),
    asyncHandler(async (req, res) =>
      reply(res, 200, await abdmService.linkInit(req.params.childId, req.guardian.id, req.mockScenario))
    )
  );
  router.post(
    '/children/:childId/care-contexts/link-confirm',
    validate('params', childParamsSchema),
    validate('body', linkConfirmSchema),
    asyncHandler(async (req, res) =>
      reply(res, 201, await abdmService.linkConfirm(req.params.childId, req.guardian.id, req.body, req.mockScenario))
    )
  );

  // ---- Consent lifecycle (the request simulates an HIU) ----
  router.post(
    '/children/:childId/consents',
    validate('params', childParamsSchema),
    validate('body', consentRequestSchema),
    asyncHandler(async (req, res) =>
      reply(res, 201, await abdmService.requestConsent(req.params.childId, req.guardian.id, req.body, req.mockScenario))
    )
  );
  router.get(
    '/children/:childId/consents',
    validate('params', childParamsSchema),
    asyncHandler(async (req, res) => reply(res, 200, await abdmService.listConsents(req.params.childId, req.guardian.id)))
  );
  router.get(
    '/consents/:consentId',
    validate('params', consentParamsSchema),
    asyncHandler(async (req, res) => reply(res, 200, await abdmService.getConsent(req.params.consentId, req.guardian.id)))
  );
  for (const action of ['approve', 'deny', 'revoke']) {
    router.post(
      `/consents/:consentId/${action}`,
      validate('params', consentParamsSchema),
      asyncHandler(async (req, res) =>
        reply(res, 200, await abdmService.decideConsent(req.params.consentId, req.guardian.id, action, req.mockScenario))
      )
    );
  }

  return router;
}

module.exports = { abdmRouter };
