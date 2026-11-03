const express = require('express');
const { z } = require('zod');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { childParamsSchema } = require('../abdm/schemas');

// The Aadhaar number is validated here and must be exactly 12 digits (CRT_ABHA_104). The message is the
// product text the test case quotes. Zod messages never repeat the value that was sent.
const requestOtpSchema = z
  .object({
    aadhaar: z.string({ required_error: 'Aadhaar Number is not valid' }).regex(/^\d{12}$/, 'Aadhaar Number is not valid'),
    // The person has agreed to the published terms (CRT_ABHA_102). Nothing is sent without it.
    consentAgreed: z.literal(true, { errorMap: () => ({ message: 'must be true: the terms must be agreed before the Aadhaar number is sent' }) }),
    txnId: z.string().min(1).max(100).optional(),
  })
  .strict();

const verifyOtpSchema = z
  .object({
    txnId: z.string({ required_error: 'is required' }).min(1).max(100),
    otp: z.string({ required_error: 'is required' }).regex(/^\d{6}$/, 'must be a 6-digit code'),
    mobile: z.string().regex(/^\d{10}$/, 'must be 10 digits').optional(),
  })
  .strict();

// Printed beside the address field (CRT_ABHA_112). ABDM has the final say; this only catches the
// obvious mistakes before a call is spent.
const addressSchema = z
  .string({ required_error: 'is required' })
  .max(60)
  .regex(/^[A-Za-z][A-Za-z0-9._]*(@(sbx|abdm))?$/, 'letters, digits, one dot and one underscore at most; must start with a letter')
  .refine((v) => !/[._]@|[._]$/.test(v) && !/^[._]/.test(v), 'must not start or end with a dot or underscore')
  .refine((v) => (v.replace(/@.*$/, '').match(/\./g) || []).length <= 1 && (v.replace(/@.*$/, '').match(/_/g) || []).length <= 1, 'at most one dot and one underscore');

// An ABHA number is 14 digits; the service wants it with its dashes, so any layout is accepted and
// normalised (the platform's own check is the final one).
const abhaNumberSchema = z
  .string({ required_error: 'is required' })
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^\d{14}$/, 'must be a 14-digit ABHA number'))
  .transform((v) => `${v.slice(0, 2)}-${v.slice(2, 6)}-${v.slice(6, 10)}-${v.slice(10)}`);
const loginRequestSchema = z.object({ abhaNumber: abhaNumberSchema, method: z.enum(['aadhaar', 'mobile']) }).strict();
const loginVerifySchema = z
  .object({ txnId: z.string().min(1).max(100), otp: z.string({ required_error: 'is required' }).regex(/^\d{6}$/, 'must be a 6-digit code') })
  .strict();

const txnQuerySchema = z.object({ txnId: z.string().min(1).max(100) }).strict();
const createAddressSchema = z.object({ txnId: z.string().min(1).max(100), abhaAddress: addressSchema }).strict();

function abhaRouter({ abhaService, auditService, limiter }) {
  const router = express.Router();

  // One audit event per call, ids and an outcome only: never the Aadhaar number, OTP or profile.
  const audited = (eventType, handler) =>
    asyncHandler(async (req, res) => {
      const base = { requestId: req.id, eventType, actorGuardianId: req.guardian.id, childId: req.params.childId };
      let result;
      try {
        result = await handler(req);
      } catch (err) {
        await auditService.recordSafely({
          ...base,
          outcome: err.status === 401 || err.status === 403 ? 'DENIED' : 'FAILURE',
          reasonCode: err.code || 'INTERNAL_ERROR',
        });
        throw err;
      }
      await auditService.record({ ...base, outcome: 'SUCCESS' });
      return res.status(200).set('X-ABDM-Mode', 'SANDBOX').json({ sandbox: true, ...result });
    });

  router.post(
    '/children/:childId/create/request-otp',
    limiter,
    validate('params', childParamsSchema),
    validate('body', requestOtpSchema),
    audited('ABHA_CREATE_OTP_REQUEST', (req) => abhaService.requestCreateOtp(req.params.childId, req.guardian.id, req.body))
  );
  router.post(
    '/children/:childId/create/verify-otp',
    limiter,
    validate('params', childParamsSchema),
    validate('body', verifyOtpSchema),
    audited('ABHA_CREATE_OTP_VERIFY', (req) => abhaService.verifyCreateOtp(req.params.childId, req.guardian.id, req.body))
  );

  router.post(
    '/children/:childId/login/request-otp',
    limiter,
    validate('params', childParamsSchema),
    validate('body', loginRequestSchema),
    audited('ABHA_LOGIN_OTP_REQUEST', (req) => abhaService.requestLoginOtp(req.params.childId, req.guardian.id, req.body))
  );
  router.post(
    '/children/:childId/login/verify-otp',
    limiter,
    validate('params', childParamsSchema),
    validate('body', loginVerifySchema),
    audited('ABHA_LOGIN_OTP_VERIFY', (req) => abhaService.verifyLoginOtp(req.params.childId, req.guardian.id, req.body))
  );

  router.get(
    '/children/:childId/create/address-suggestions',
    limiter,
    validate('params', childParamsSchema),
    validate('query', txnQuerySchema),
    audited('ABHA_ADDRESS_SUGGEST', (req) => abhaService.suggestAddresses(req.params.childId, req.guardian.id, req.query))
  );
  router.post(
    '/children/:childId/create/address',
    limiter,
    validate('params', childParamsSchema),
    validate('body', createAddressSchema),
    audited('ABHA_ADDRESS_CREATE', (req) => abhaService.createAddress(req.params.childId, req.guardian.id, req.body))
  );
  router.get(
    '/children/:childId/:flow(create|login)/profile',
    limiter,
    validate('params', childParamsSchema),
    validate('query', txnQuerySchema),
    audited('ABHA_PROFILE_READ', (req) => abhaService.getProfile(req.params.childId, req.guardian.id, req.query))
  );
  // The card is an image, so it is sent as bytes instead of JSON.
  router.get(
    '/children/:childId/:flow(create|login)/card',
    limiter,
    validate('params', childParamsSchema),
    validate('query', txnQuerySchema),
    asyncHandler(async (req, res) => {
      const base = { requestId: req.id, eventType: 'ABHA_CARD_READ', actorGuardianId: req.guardian.id, childId: req.params.childId };
      let card;
      try {
        card = await abhaService.getCard(req.params.childId, req.guardian.id, req.query);
      } catch (err) {
        await auditService.recordSafely({ ...base, outcome: 'FAILURE', reasonCode: err.code || 'INTERNAL_ERROR' });
        throw err;
      }
      await auditService.record({ ...base, outcome: 'SUCCESS' });
      res.status(200).set('X-ABDM-Mode', 'SANDBOX').type(card.contentType || 'image/png').send(card.data);
    })
  );

  return router;
}

module.exports = { abhaRouter };
