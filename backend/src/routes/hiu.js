const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { childParamsSchema } = require('../abdm/schemas');

const abhaAddress = z.string({ required_error: 'is required' }).regex(/^[A-Za-z][A-Za-z0-9._]{2,}@(sbx|abdm)$/, 'must look like name@sbx');
const isoDate = z.string({ required_error: 'is required' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const consentSchema = z
  .object({
    abhaAddress,
    purposeCode: z.string({ required_error: 'is required' }),
    dateFrom: isoDate,
    dateTo: isoDate,
    dataEraseAt: z.string({ required_error: 'is required' }).datetime({ message: 'must be an ISO 8601 date-time' }),
  })
  .strict()
  .refine((v) => v.dateFrom <= v.dateTo, { message: 'dateFrom must not be after dateTo', path: ['dateTo'] })
  .refine((v) => new Date(v.dataEraseAt) > new Date(), { message: 'must be in the future', path: ['dataEraseAt'] });
const requestParams = z.object({ childId: z.string().uuid(), requestId: z.string().uuid() });

// Guardian-facing API for M3 as a HIU (REAL sandbox). Owner-only. The records returned are the child's own.
function hiuRouter({ hiu, auditService }) {
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
    '/children/:childId/consent-requests',
    validate('params', childParamsSchema),
    validate('body', consentSchema),
    audited('HIU_CONSENT_REQUEST', 202, (req) => hiu.requestConsent(req.params.childId, req.guardian.id, req.body))
  );
  router.get(
    '/children/:childId/consent-requests',
    validate('params', childParamsSchema),
    asyncHandler(async (req, res) => res.set('X-ABDM-Mode', 'SANDBOX').json({ sandbox: true, ...(await hiu.list(req.params.childId, req.guardian.id)) }))
  );
  router.post(
    '/children/:childId/consent-requests/:requestId/refresh',
    validate('params', requestParams),
    audited('HIU_CONSENT_STATUS', 202, (req) => hiu.refreshStatus(req.params.childId, req.guardian.id, req.params.requestId))
  );
  router.post(
    '/children/:childId/consent-requests/:requestId/fetch',
    validate('params', requestParams),
    audited('HIU_RECORDS_FETCH', 202, (req) => hiu.fetchRecords(req.params.childId, req.guardian.id, req.params.requestId))
  );
  router.get(
    '/children/:childId/records',
    validate('params', childParamsSchema),
    audited('HIU_RECORDS_READ', 200, (req) => hiu.records(req.params.childId, req.guardian.id))
  );
  return router;
}

module.exports = { hiuRouter };
