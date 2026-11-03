// MOCK ABDM prototype. Nothing here talks to the real ABDM sandbox or production.

const MOCK_NOTICE = 'MOCK ABDM prototype - synthetic data, not connected to the real ABDM';

// The mock OTP is public on purpose. A real flow sends a one-time code to the person's mobile.
const MOCK_OTP = '123456';

// Consent statuses as listed in the official ABDM M3 page.
const CONSENT_STATUS = {
  REQUESTED: 'REQUESTED',
  GRANTED: 'GRANTED',
  DENIED: 'DENIED',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
};

// Illustrative subsets - confirm against the official code lists before any real integration.
const PURPOSES = ['CAREMGT', 'PUBHLTH', 'HPAYMT'];
const HI_TYPES = ['ImmunizationRecord'];

// Scenarios the mock gateway can simulate, chosen per request with the X-Mock-Scenario header.
const SCENARIOS = [
  'success',
  'invalid_auth',
  'invalid_request',
  'consent_denied',
  'consent_expired',
  'consent_revoked',
  'timeout',
  'unavailable',
  'transient_failure', // fails once, then succeeds: shows the bounded retry working
  'duplicate_callback', // the same callback arrives twice: shows idempotency
];

module.exports = { MOCK_NOTICE, MOCK_OTP, CONSENT_STATUS, PURPOSES, HI_TYPES, SCENARIOS };
