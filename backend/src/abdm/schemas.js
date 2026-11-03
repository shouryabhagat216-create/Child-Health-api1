const { z } = require('zod');
const { ABHA_FORMAT } = require('./syntheticAbha');
const { PURPOSES, HI_TYPES } = require('./constants');

const uuid = (name) =>
  z.string({ required_error: 'is required', invalid_type_error: 'must be a string' }).uuid(`${name} must be a valid UUID`);

const childParamsSchema = z.object({ childId: uuid('childId') });
const consentParamsSchema = z.object({ consentId: uuid('consentId') });

const verifyAbhaSchema = z
  .object({
    abhaNumber: z
      .string({ required_error: 'is required' })
      .regex(ABHA_FORMAT, 'must look like 00-1234-5678-9012 (14 digits)'),
    otp: z.string({ required_error: 'is required' }).regex(/^\d{6}$/, 'must be a 6-digit code'),
  })
  .strict();

const linkConfirmSchema = z
  .object({
    transactionId: uuid('transactionId'),
    otp: z.string({ required_error: 'is required' }).regex(/^\d{6}$/, 'must be a 6-digit code'),
  })
  .strict();

const isoDate = z
  .string({ required_error: 'is required' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be in YYYY-MM-DD format')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'must be a valid calendar date');

// Simulates a Health Information User (HIU) asking for access to a child's records.
const consentRequestSchema = z
  .object({
    requesterName: z.string().trim().min(1).max(100).default('MOCK Health Information User'),
    purpose: z.enum(PURPOSES, { errorMap: () => ({ message: `must be one of: ${PURPOSES.join(', ')}` }) }),
    hiTypes: z
      .array(z.enum(HI_TYPES, { errorMap: () => ({ message: `must be one of: ${HI_TYPES.join(', ')}` }) }))
      .min(1, 'must contain at least one type'),
    dateFrom: isoDate,
    dateTo: isoDate,
    expiresAt: z.string().datetime({ message: 'must be an ISO 8601 date-time, e.g. 2026-12-01T00:00:00Z' }).optional(),
  })
  .strict();

module.exports = {
  childParamsSchema,
  consentParamsSchema,
  verifyAbhaSchema,
  linkConfirmSchema,
  consentRequestSchema,
};
