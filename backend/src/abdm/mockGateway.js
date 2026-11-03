const { AppError } = require('../errors');

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

// Stands in for the ABDM gateway. It decides, per request, whether the "gateway" succeeds or
// fails in one of the ways the real one can. The real operation (`fn`) runs only when the
// scenario lets it through.
//
// Retry policy: transient failures (timeout / unavailable) are retried a fixed small number of
// times, then we give up with a clear error. Retries are never unlimited, and `fn` itself is never
// retried after it has run, so a retry can never apply the same change twice.
function createMockGateway({ maxAttempts = 3, retryDelayMs = 200 } = {}) {
  const transient = (scenario) =>
    scenario === 'timeout'
      ? new AppError(504, 'GATEWAY_TIMEOUT', 'The mock ABDM gateway timed out')
      : new AppError(503, 'GATEWAY_UNAVAILABLE', 'The mock ABDM gateway is unavailable');

  return {
    // `idempotent` marks operations that are safe to receive twice (consent decisions).
    async execute(scenario, operation, fn, { idempotent = false } = {}) {
      switch (scenario) {
        case 'invalid_auth':
          throw new AppError(401, 'GATEWAY_UNAUTHORIZED', 'The mock gateway rejected the session token');
        case 'invalid_request':
          throw new AppError(400, 'GATEWAY_INVALID_REQUEST', 'The mock gateway rejected the request as malformed');
        case 'consent_denied':
          throw new AppError(403, 'CONSENT_DENIED', 'The guardian denied this consent request');
        case 'consent_expired':
          throw new AppError(403, 'CONSENT_EXPIRED', 'The consent has expired');
        case 'consent_revoked':
          // The real docs list ABDM-1062 as "consent not granted: revoked or lapsed".
          throw new AppError(403, 'CONSENT_REVOKED', 'The consent was revoked (modelled on ABDM-1062)');
        case 'timeout':
        case 'unavailable': {
          for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            if (attempt < maxAttempts) await sleep(retryDelayMs);
          }
          const err = transient(scenario);
          err.details = { operation, attempts: maxAttempts, gaveUp: true };
          throw err;
        }
        case 'transient_failure': {
          await sleep(retryDelayMs); // attempt 1 fails, attempt 2 goes through
          const result = await fn();
          return { ...result, gatewayAttempts: 2 };
        }
        case 'duplicate_callback': {
          if (!idempotent) {
            throw new AppError(
              400,
              'SCENARIO_NOT_SUPPORTED',
              `Scenario 'duplicate_callback' only applies to idempotent operations, not '${operation}'`
            );
          }
          const first = await fn();
          await fn(); // the duplicate delivery; it must not change anything
          return { ...first, duplicateCallbackIgnored: true };
        }
        default:
          return fn();
      }
    },
  };
}

module.exports = { createMockGateway };
