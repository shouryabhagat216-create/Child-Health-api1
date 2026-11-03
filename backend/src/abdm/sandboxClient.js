const { randomUUID } = require('crypto');
const { AppError } = require('../errors');

// REAL ABDM SANDBOX client (not the mock). Only talks to the sandbox gateway.
// Request shape (headers and body) is from the official gateway-session example:
//   POST {base}/api/hiecm/gateway/v3/sessions
//   headers REQUEST-ID (fresh UUID), TIMESTAMP (ISO 8601 UTC), X-CM-ID: sbx, Content-Type: application/json
//   body { clientId, clientSecret, grantType: "client_credentials" }
// The docs pages available did not show the response fields, so the token field name
// (accessToken, or access_token) is an assumption that the first real call will confirm.
//
// Safety rules in this file:
//  - the client secret and tokens are never logged, returned or put in error messages;
//  - only the sandbox host is allowed, so production can never be called by accident;
//  - only the session call is retried (the docs say it is safe to repeat).
const ALLOWED_SANDBOX_HOSTS = ['dev.abdm.gov.in'];

function assertSandboxConfig(abdm) {
  if (!abdm.clientId || !abdm.clientSecret) {
    throw new Error('ABDM_MODE=sandbox needs ABDM_CLIENT_ID and ABDM_CLIENT_SECRET in your .env');
  }
  let host;
  try {
    host = new URL(abdm.gatewayBaseUrl).host;
  } catch {
    throw new Error('ABDM_GATEWAY_BASE_URL is not a valid URL');
  }
  if (!ALLOWED_SANDBOX_HOSTS.includes(host)) {
    throw new Error(`ABDM_GATEWAY_BASE_URL host '${host}' is not an allowed sandbox host`);
  }
}

function createSandboxClient({ config, fetchImpl = globalThis.fetch, now = () => new Date(), newId = randomUUID }) {
  assertSandboxConfig(config);
  const url = `${config.gatewayBaseUrl.replace(/\/$/, '')}/api/hiecm/gateway/v3/sessions`;
  const maxAttempts = config.sessionMaxAttempts || 2;
  let cached = null; // { token, expiresAt } kept in memory only

  async function requestSession() {
    const requestId = newId();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs || 10000);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'REQUEST-ID': requestId,
          TIMESTAMP: now().toISOString(),
          'X-CM-ID': config.cmId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          grantType: 'client_credentials',
        }),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok, body, requestId };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    // Returns the access token for use on later calls. Never expose it to API clients.
    async getToken() {
      if (cached && cached.expiresAt > now().getTime()) return cached.token;

      let result;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          result = await requestSession();
        } catch {
          // network error or timeout; retry (bounded), then give up
          if (attempt === maxAttempts) {
            throw new AppError(504, 'ABDM_SANDBOX_UNREACHABLE', 'Could not reach the ABDM sandbox gateway', { attempts: attempt });
          }
          continue;
        }
        if (result.status >= 500 && attempt < maxAttempts) continue; // transient server error: retry
        break;
      }

      if (!result.ok) {
        // Pass on the sandbox's own error code and message so a failure can be diagnosed, but
        // redact our client id and secret in case the sandbox echoes them, and cap the length.
        // The request we sent is never included.
        const b = result.body || {};
        const nested = typeof b.error === 'object' && b.error ? b.error : {};
        const pick = (...vals) => vals.find((v) => typeof v === 'string' && v);
        const code = pick(b.code, b.errorCode, nested.code);
        const message = pick(b.message, b.error_description, nested.message, typeof b.error === 'string' ? b.error : undefined);
        const redact = (text) =>
          text && text.split(config.clientSecret).join('[redacted]').split(config.clientId).join('[redacted]').slice(0, 300);
        throw new AppError(502, 'ABDM_SANDBOX_REJECTED', 'The ABDM sandbox rejected the session request', {
          sandboxStatus: result.status,
          sandboxCode: redact(code),
          sandboxMessage: redact(message),
          responseFields: Object.keys(b), // field names only
          requestId: result.requestId,
        });
      }
      const token = result.body.accessToken || result.body.access_token;
      if (typeof token !== 'string' || !token) {
        throw new AppError(502, 'ABDM_SANDBOX_UNEXPECTED_RESPONSE', 'The sandbox session response had no access token', {
          responseFields: Object.keys(result.body), // field names only, never values
          requestId: result.requestId,
        });
      }
      const expiresIn = Number(result.body.expiresIn ?? result.body.expires_in);
      if (Number.isFinite(expiresIn) && expiresIn > 60) {
        cached = { token, expiresAt: now().getTime() + (expiresIn - 30) * 1000 };
      }
      return token;
    },

    // Connectivity check: proves the credentials work without revealing the token.
    async ping() {
      cached = null; // always a real call
      const token = await this.getToken();
      return { tokenReceived: Boolean(token) };
    },
  };
}

module.exports = { createSandboxClient, assertSandboxConfig, ALLOWED_SANDBOX_HOSTS };
