const { createApp } = require('../src/app');
const { MemoryRepository } = require('../src/repositories/memoryRepository');
const { createSandboxClient, assertSandboxConfig } = require('../src/abdm/sandboxClient');
const { TEST_CONFIG, authedRequest, anonymousRequest } = require('./helpers/auth');

// These tests use a FAKE fetch. They never contact the real sandbox and need no real credentials.
const FAKE_SECRET = 'fake-secret-for-tests-only';
const FAKE_TOKEN = 'fake-token-value-123';
const abdmConfig = {
  clientId: 'SBX_TEST',
  clientSecret: FAKE_SECRET,
  gatewayBaseUrl: 'https://dev.abdm.gov.in',
  cmId: 'sbx',
  timeoutMs: 1000,
};

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function appWith(fetchImpl) {
  const client = createSandboxClient({ config: abdmConfig, fetchImpl });
  const app = createApp({ repo: new MemoryRepository(), logRequests: false, config: TEST_CONFIG, sandboxClient: client });
  return { app, as: () => authedRequest(app) };
}

describe('sandbox client request', () => {
  test('sends the documented headers and body to the sandbox session endpoint', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, { accessToken: FAKE_TOKEN, expiresIn: 600 });
    };
    const { as } = appWith(fetchImpl);
    await as().get('/sandbox/ping').expect(200);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe('https://dev.abdm.gov.in/api/hiecm/gateway/v3/sessions');
    expect(init.method).toBe('POST');
    expect(init.headers['REQUEST-ID']).toMatch(/^[0-9a-f-]{36}$/);
    expect(init.headers.TIMESTAMP).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(init.headers['X-CM-ID']).toBe('sbx');
    expect(JSON.parse(init.body)).toEqual({ clientId: 'SBX_TEST', clientSecret: FAKE_SECRET, grantType: 'client_credentials' });
  });

  test('uses a fresh REQUEST-ID each time', async () => {
    const ids = [];
    const fetchImpl = async (url, init) => {
      ids.push(init.headers['REQUEST-ID']);
      return jsonResponse(200, { accessToken: FAKE_TOKEN });
    };
    const { as } = appWith(fetchImpl);
    await as().get('/sandbox/ping').expect(200);
    await as().get('/sandbox/ping').expect(200);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('GET /sandbox/ping', () => {
  test('success never returns the token or the secret', async () => {
    const { as } = appWith(async () => jsonResponse(200, { accessToken: FAKE_TOKEN, expiresIn: 600 }));
    const res = await as().get('/sandbox/ping').expect(200);
    expect(res.body).toEqual({ sandbox: true, tokenReceived: true });
    expect(res.headers['x-abdm-mode']).toBe('SANDBOX');
    const text = JSON.stringify(res.body) + JSON.stringify(res.headers);
    expect(text).not.toContain(FAKE_TOKEN);
    expect(text).not.toContain(FAKE_SECRET);
  });

  test('requires login', async () => {
    const { app } = appWith(async () => jsonResponse(200, { accessToken: FAKE_TOKEN }));
    await anonymousRequest(app).get('/sandbox/ping').expect(401);
  });

  test('is disabled (409) when not in sandbox mode', async () => {
    const app = createApp({ repo: new MemoryRepository(), logRequests: false, config: TEST_CONFIG });
    const res = await authedRequest(app).get('/sandbox/ping').expect(409);
    expect(res.body.error.code).toBe('SANDBOX_NOT_ENABLED');
  });

  test('a rejection gives 502 with the sandbox status, without leaking the secret or the body', async () => {
    const { as } = appWith(async () => jsonResponse(401, { code: 'ABDM-1010', message: `bad ${FAKE_SECRET}` }));
    const res = await as().get('/sandbox/ping').expect(502);
    expect(res.body.error.code).toBe('ABDM_SANDBOX_REJECTED');
    expect(res.body.error.details).toMatchObject({ sandboxStatus: 401, sandboxCode: 'ABDM-1010' });
    expect(JSON.stringify(res.body)).not.toContain(FAKE_SECRET);
  });

  test('surfaces nested sandbox error code and message, redacting credentials', async () => {
    const { as } = appWith(async () =>
      jsonResponse(400, { error: { code: 'ABDM-9999', message: `invalid ${FAKE_SECRET} for SBX_TEST` } })
    );
    const res = await as().get('/sandbox/ping').expect(502);
    expect(res.body.error.details).toMatchObject({
      sandboxStatus: 400,
      sandboxCode: 'ABDM-9999',
      sandboxMessage: 'invalid [redacted] for [redacted]',
    });
    expect(JSON.stringify(res.body)).not.toContain(FAKE_SECRET);
  });

  test('a response with no token reports only the field names', async () => {
    const { as } = appWith(async () => jsonResponse(200, { somethingElse: 'secret-looking-value' }));
    const res = await as().get('/sandbox/ping').expect(502);
    expect(res.body.error.code).toBe('ABDM_SANDBOX_UNEXPECTED_RESPONSE');
    expect(res.body.error.details.responseFields).toEqual(['somethingElse']);
    expect(JSON.stringify(res.body)).not.toContain('secret-looking-value');
  });

  test('network failure is retried a bounded number of times, then gives 504', async () => {
    let calls = 0;
    const { as } = appWith(async () => {
      calls += 1;
      throw new Error('ECONNREFUSED');
    });
    const res = await as().get('/sandbox/ping').expect(504);
    expect(res.body.error.code).toBe('ABDM_SANDBOX_UNREACHABLE');
    expect(calls).toBe(2);
  });

  test('a 4xx rejection is NOT retried', async () => {
    let calls = 0;
    const { as } = appWith(async () => {
      calls += 1;
      return jsonResponse(401, {});
    });
    await as().get('/sandbox/ping').expect(502);
    expect(calls).toBe(1);
  });

  test('a 5xx from the sandbox is retried once, then succeeds', async () => {
    let calls = 0;
    const { as } = appWith(async () => {
      calls += 1;
      return calls === 1 ? jsonResponse(503, {}) : jsonResponse(200, { accessToken: FAKE_TOKEN });
    });
    await as().get('/sandbox/ping').expect(200);
    expect(calls).toBe(2);
  });
});

describe('sandbox configuration safety', () => {
  test('refuses a production or unknown host', () => {
    expect(() => assertSandboxConfig({ ...abdmConfig, gatewayBaseUrl: 'https://apis.abdm.gov.in' })).toThrow(/not an allowed sandbox host/);
    expect(() => assertSandboxConfig({ ...abdmConfig, gatewayBaseUrl: 'https://evil.example' })).toThrow();
  });

  test('refuses to start without credentials', () => {
    expect(() => assertSandboxConfig({ ...abdmConfig, clientId: '' })).toThrow(/ABDM_CLIENT_ID/);
    expect(() => assertSandboxConfig({ ...abdmConfig, clientSecret: '' })).toThrow(/ABDM_CLIENT_SECRET/);
  });
});
