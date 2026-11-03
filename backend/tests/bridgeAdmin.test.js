const { createBridgeAdmin, validatePublicUrl, buildHipService } = require('../src/abdm/bridgeAdmin');

// FAKE fetch only: nothing here contacts the real sandbox.
const config = { gatewayBaseUrl: 'https://dev.abdm.gov.in', cmId: 'sbx' };
const FAKE_TOKEN = 'fake-token-abc';
const client = { getToken: async () => FAKE_TOKEN };
const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
const facility = { serviceId: 'SVC-TEST-1', hipName: 'CHIPDEMO', alias: ['chipdemo'] };

describe('bridge URL validation', () => {
  test('accepts a public https URL and strips a trailing slash', () => {
    expect(validatePublicUrl('https://abc.example.com/')).toBe('https://abc.example.com');
  });
  test.each(['http://abc.example.com', 'https://localhost:3000', 'https://127.0.0.1', 'not a url', 'https://my.local'])(
    'rejects %s',
    (url) => expect(() => validatePublicUrl(url)).toThrow(/bridge URL/)
  );
});

describe('HIP service builder', () => {
  test('builds the documented service shape from configuration', () => {
    const svc = buildHipService(facility, 'https://abc.example.com');
    expect(svc).toEqual({
      id: 'SVC-TEST-1',
      name: 'CHIPDEMO',
      type: 'HIP',
      active: true,
      alias: ['chipdemo'],
      endpoints: [{ address: 'https://abc.example.com', connectionType: 'https', use: 'registration' }],
    });
  });
  test('enforces the HIP name rule (15 characters, no special characters)', () => {
    expect(() => buildHipService({ ...facility, hipName: 'THIS-IS-TOO-LONG-AND-BAD' }, 'https://a.example.com')).toThrow(/hipName/);
    expect(() => buildHipService({ ...facility, hipName: 'bad name!' }, 'https://a.example.com')).toThrow(/hipName/);
  });
  test('requires a service id (nothing is hardcoded)', () => {
    expect(() => buildHipService({ hipName: 'OKNAME' }, 'https://a.example.com')).toThrow(/serviceId/);
  });
});

describe('bridge admin requests', () => {
  test('planning never contacts the sandbox or includes the token', () => {
    let called = false;
    const admin = createBridgeAdmin({ config, client, fetchImpl: async () => { called = true; } });
    const plan = admin.plan.setBridgeUrl('https://abc.example.com');
    expect(plan).toEqual({ method: 'PATCH', url: 'https://dev.abdm.gov.in/gateway/v1/bridges', body: { url: 'https://abc.example.com' } });
    expect(called).toBe(false);
    expect(JSON.stringify(plan)).not.toContain(FAKE_TOKEN);
  });

  test('sending uses the bearer token and X-CM-ID', async () => {
    const calls = [];
    const admin = createBridgeAdmin({ config, client, fetchImpl: async (url, init) => { calls.push({ url, init }); return reply(200, { ok: true }); } });
    const result = await admin.send(admin.plan.getServices());
    expect(result).toMatchObject({ status: 200, ok: true });
    expect(calls[0].url).toBe('https://dev.abdm.gov.in/gateway/v1/bridges/getServices');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(calls[0].init.headers['X-CM-ID']).toBe('sbx');
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
  });

  test('add service posts an array with the service', async () => {
    const calls = [];
    const admin = createBridgeAdmin({ config, client, fetchImpl: async (url, init) => { calls.push({ url, init }); return reply(200, {}); } });
    await admin.send(admin.plan.addHipService(facility, 'https://abc.example.com'));
    expect(calls[0].init.method).toBe('POST');
    expect(Array.isArray(JSON.parse(calls[0].init.body))).toBe(true);
  });
});
