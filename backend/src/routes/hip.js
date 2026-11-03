const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { childParamsSchema } = require('../abdm/schemas');

const abhaAddress = z
  .string({ required_error: 'is required' })
  .regex(/^[A-Za-z][A-Za-z0-9._]{2,}@(sbx|abdm)$/, 'must look like name@sbx');
const tokenSchema = z.object({ abhaAddress, gender: z.enum(['M', 'F', 'O'], { errorMap: () => ({ message: 'must be M, F or O' }) }) }).strict();
const linkSchema = z.object({ abhaAddress }).strict();
const registerSchema = z.object({ abhaAddress }).strict();

// Guardian-facing API for M2 as a HIP (REAL sandbox). Owner-only; the link token never appears here.
function hipRouter({ hipLinking, auditService }) {
  const router = express.Router();
  const audited = (eventType, status, handler) =>
    asyncHandler(async (req, res) => {
      const base = { requestId: req.id, eventType, actorGuardianId: req.guardian.id, childId: req.params.childId };
      let result;
      try {
        result = await handler(req);
      } catch (err) {
        await auditService.recordSafely({ ...base, outcome: err.status === 401 || err.status === 403 ? 'DENIED' : 'FAILURE', reasonCode: err.code || 'INTERNAL_ERROR' });
        throw err;
      }
      await auditService.record({ ...base, outcome: 'SUCCESS' });
      return res.status(status).set('X-ABDM-Mode', 'SANDBOX').json({ sandbox: true, ...result });
    });

  router.post(
    '/children/:childId/link-token',
    validate('params', childParamsSchema),
    validate('body', tokenSchema),
    audited('HIP_LINK_TOKEN_REQUEST', 202, (req) => hipLinking.requestLinkToken(req.params.childId, req.guardian.id, req.body))
  );
  router.post(
    '/children/:childId/link-care-context',
    validate('params', childParamsSchema),
    validate('body', linkSchema),
    audited('HIP_CARE_CONTEXT_LINK', 202, (req) => hipLinking.linkCareContext(req.params.childId, req.guardian.id, req.body))
  );
  router.post(
    '/children/:childId/abha-address',
    validate('params', childParamsSchema),
    validate('body', registerSchema),
    audited('HIP_ABHA_ADDRESS_REGISTER', 200, (req) => hipLinking.registerAddress(req.params.childId, req.guardian.id, req.body))
  );
  // The code a patient must enter to confirm a link started from their PHR app. Shown once to the owning guardian
  // (stands in for an SMS). The audit trail records that it was read, never the code.
  router.get(
    '/children/:childId/link-code',
    validate('params', childParamsSchema),
    audited('HIP_LINK_CODE_READ', 200, (req) => hipLinking.readLinkOtp(req.params.childId, req.guardian.id))
  );
  router.get(
    '/children/:childId/link-status',
    validate('params', childParamsSchema),
    asyncHandler(async (req, res) => res.set('X-ABDM-Mode', 'SANDBOX').json({ sandbox: true, ...(await hipLinking.status(req.params.childId, req.guardian.id)) }))
  );
  return router;
}

module.exports = { hipRouter };
