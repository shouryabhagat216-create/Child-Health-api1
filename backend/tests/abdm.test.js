const { createApp } = require('../src/app');
const { MemoryRepository } = require('../src/repositories/memoryRepository');
const { createAbdmService } = require('../src/services/abdmService');
const { createMockGateway } = require('../src/abdm/mockGateway');
const { syntheticAbhaFor } = require('../src/abdm/syntheticAbha');
const { TEST_CONFIG, authedRequest, anonymousRequest, NEHA, ROHIT } = require('./helpers/auth');

// All data below is synthetic. These tests exercise the MOCK ABDM prototype only.
const validChild = {
  name: 'Aarav Sharma',
  dateOfBirth: '2024-03-15',
  guardianName: 'Neha Sharma',
  state: 'Maharashtra',
  consentStatus: 'granted',
};
const OTP = '123456';
const consentInput = {
  purpose: 'CAREMGT',
  hiTypes: ['ImmunizationRecord'],
  dateFrom: '2024-01-01',
  dateTo: '2025-01-01',
};

function setup() {
  const repo = new MemoryRepository();
  const app = createApp({ repo, logRequests: false, config: TEST_CONFIG });
  const as = (guardian = NEHA) => authedRequest(app, guardian);
  return { repo, app, as };
}

const newChild = async (as) => (await as().post('/children').send(validChild).expect(201)).body;

const verifyAbha = (as, childId, headers = {}) =>
  as()
    .post(`/abdm/children/${childId}/abha/verify`)
    .set(headers)
    .send({ abhaNumber: syntheticAbhaFor(childId), otp: OTP });

// A child with a verified ABHA, ready for linking or consent.
async function verifiedChild() {
  const ctx = setup();
  const child = await newChild(ctx.as);
  await verifyAbha(ctx.as, child.id).expect(200);
  return { ...ctx, child };
}

const requestConsent = (as, childId, body = consentInput, headers = {}) =>
  as().post(`/abdm/children/${childId}/consents`).set(headers).send(body);

describe('ABDM mock: access and labelling', () => {
  test('requires a token', async () => {
    await anonymousRequest(setup().app).get('/abdm/mock-scenarios').expect(401);
  });

  test('every response is labelled as MOCK', async () => {
    const res = await setup().as().get('/abdm/mock-scenarios').expect(200);
    expect(res.body.mock).toBe(true);
    expect(res.body.notice).toMatch(/MOCK/);
    expect(res.headers['x-abdm-mode']).toBe('MOCK');
  });

  test('unknown X-Mock-Scenario is rejected with 400', async () => {
    await setup().as().get('/abdm/mock-scenarios').set('X-Mock-Scenario', 'chaos').expect(400);
  });
});

describe('ABDM mock: M1 ABHA verification', () => {
  test('verifies a synthetic ABHA and returns only the masked number', async () => {
    const { as } = setup();
    const child = await newChild(as);
    const sample = await as().get(`/abdm/children/${child.id}/abha/sample`).expect(200);
    expect(sample.body.abhaNumber).toBe(syntheticAbhaFor(child.id)); // deterministic
    const res = await verifyAbha(as, child.id).expect(200);
    expect(res.body.abha.abhaNumberMasked).toMatch(/^\*\*-\*{4}-\*{4}-\d{4}$/);
    expect(JSON.stringify(res.body)).not.toContain(sample.body.abhaNumber);
  });

  test('wrong OTP gives 400 and an unknown ABHA gives 404', async () => {
    const { as } = setup();
    const child = await newChild(as);
    await as()
      .post(`/abdm/children/${child.id}/abha/verify`)
      .send({ abhaNumber: syntheticAbhaFor(child.id), otp: '000000' })
      .expect(400);
    const res = await as()
      .post(`/abdm/children/${child.id}/abha/verify`)
      .send({ abhaNumber: '00-1111-2222-3333', otp: OTP })
      .expect(404);
    expect(res.body.error.code).toBe('ABHA_NOT_FOUND');
  });

  test('a malformed ABHA number is a 400 validation error', async () => {
    const { as } = setup();
    const child = await newChild(as);
    const res = await as().post(`/abdm/children/${child.id}/abha/verify`).send({ abhaNumber: '123', otp: OTP }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test("another guardian cannot touch the child's ABHA (404)", async () => {
    const { as, child } = await verifiedChild();
    await as(ROHIT).get(`/abdm/children/${child.id}/abha`).expect(404);
    await verifyAbha(() => as(ROHIT), child.id).expect(404);
  });
});

describe('ABDM mock: M2 care-context linking', () => {
  const link = async (as, childId) => {
    const init = await as().post(`/abdm/children/${childId}/care-contexts/link-init`).expect(200);
    return as()
      .post(`/abdm/children/${childId}/care-contexts/link-confirm`)
      .send({ transactionId: init.body.transactionId, otp: OTP });
  };

  test('linking needs a verified ABHA first (409)', async () => {
    const { as } = setup();
    const child = await newChild(as);
    const res = await as().post(`/abdm/children/${child.id}/care-contexts/link-init`).expect(409);
    expect(res.body.error.code).toBe('ABHA_NOT_VERIFIED');
  });

  test('init then confirm links the care context; linking twice is a 409', async () => {
    const { as, child } = await verifiedChild();
    const init = await as().post(`/abdm/children/${child.id}/care-contexts/link-init`).expect(200);
    expect(init.body).toMatchObject({ authType: 'DIRECT', medium: 'MOBILE_OTP' });
    const confirmed = await as()
      .post(`/abdm/children/${child.id}/care-contexts/link-confirm`)
      .send({ transactionId: init.body.transactionId, otp: OTP })
      .expect(201);
    expect(confirmed.body.careContext.reference).toBe('immunization-record');
    const list = await as().get(`/abdm/children/${child.id}/care-contexts`).expect(200);
    expect(list.body.careContexts).toHaveLength(1);
    const again = await as().post(`/abdm/children/${child.id}/care-contexts/link-init`).expect(409);
    expect(again.body.error.code).toBe('CARE_CONTEXT_ALREADY_LINKED');
  });

  test('three wrong OTPs kill the transaction (bounded attempts)', async () => {
    const { as, child } = await verifiedChild();
    const init = await as().post(`/abdm/children/${child.id}/care-contexts/link-init`).expect(200);
    const confirm = (otp) =>
      as()
        .post(`/abdm/children/${child.id}/care-contexts/link-confirm`)
        .send({ transactionId: init.body.transactionId, otp });
    await confirm('000000').expect(400);
    await confirm('000000').expect(400);
    const third = await confirm('000000').expect(400);
    expect(third.body.error.code).toBe('TOO_MANY_OTP_ATTEMPTS');
    const afterwards = await confirm(OTP).expect(404); // even the right code no longer works
    expect(afterwards.body.error.code).toBe('TRANSACTION_NOT_FOUND');
  });

  test("another guardian cannot use someone else's link transaction", async () => {
    const { as, child } = await verifiedChild();
    const init = await as().post(`/abdm/children/${child.id}/care-contexts/link-init`).expect(200);
    await as(ROHIT)
      .post(`/abdm/children/${child.id}/care-contexts/link-confirm`)
      .send({ transactionId: init.body.transactionId, otp: OTP })
      .expect(404);
  });
});

describe('ABDM mock: consent lifecycle', () => {
  test('a consent request needs a verified ABHA', async () => {
    const { as } = setup();
    const child = await newChild(as);
    await requestConsent(as, child.id).expect(409);
  });

  test('creates a REQUESTED consent with a default expiry inside the limit', async () => {
    const { as, child } = await verifiedChild();
    const res = await requestConsent(as, child.id).expect(201);
    expect(res.body.consent).toMatchObject({ status: 'REQUESTED', purpose: 'CAREMGT', hiTypes: ['ImmunizationRecord'] });
    const days = (new Date(res.body.consent.expiresAt) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });

  test('rejects bad purpose, bad dates and an expiry beyond the maximum', async () => {
    const { as, child } = await verifiedChild();
    await requestConsent(as, child.id, { ...consentInput, purpose: 'ADS' }).expect(400);
    await requestConsent(as, child.id, { ...consentInput, dateFrom: '2025-06-01', dateTo: '2025-01-01' }).expect(400);
    await requestConsent(as, child.id, { ...consentInput, dateTo: '2999-01-01' }).expect(400);
    const far = new Date(Date.now() + 200 * 86400000).toISOString();
    const res = await requestConsent(as, child.id, { ...consentInput, expiresAt: far }).expect(400);
    expect(res.body.error.details[0].field).toBe('expiresAt');
  });

  test('approve then revoke; a decision cannot be undone by approving again', async () => {
    const { as, child } = await verifiedChild();
    const id = (await requestConsent(as, child.id).expect(201)).body.consent.id;
    const approved = await as().post(`/abdm/consents/${id}/approve`).expect(200);
    expect(approved.body.consent.status).toBe('GRANTED');
    const revoked = await as().post(`/abdm/consents/${id}/revoke`).expect(200);
    expect(revoked.body.consent.status).toBe('REVOKED');
    const res = await as().post(`/abdm/consents/${id}/approve`).expect(409);
    expect(res.body.error.code).toBe('INVALID_CONSENT_TRANSITION');
  });

  test('deny is final', async () => {
    const { as, child } = await verifiedChild();
    const id = (await requestConsent(as, child.id).expect(201)).body.consent.id;
    const denied = await as().post(`/abdm/consents/${id}/deny`).expect(200);
    expect(denied.body.consent.status).toBe('DENIED');
    await as().post(`/abdm/consents/${id}/approve`).expect(409);
  });

  test('repeating the same decision is an idempotent no-op', async () => {
    const { as, child } = await verifiedChild();
    const id = (await requestConsent(as, child.id).expect(201)).body.consent.id;
    expect((await as().post(`/abdm/consents/${id}/approve`).expect(200)).body.changed).toBe(true);
    expect((await as().post(`/abdm/consents/${id}/approve`).expect(200)).body.changed).toBe(false);
  });

  test("only the owning guardian can decide; the other gets 404 and nothing changes", async () => {
    const { as, child } = await verifiedChild();
    const id = (await requestConsent(as, child.id).expect(201)).body.consent.id;
    await as(ROHIT).post(`/abdm/consents/${id}/approve`).expect(404);
    await as(ROHIT).get(`/abdm/consents/${id}`).expect(404);
    await as(ROHIT).get(`/abdm/children/${child.id}/consents`).expect(404);
    expect((await as().get(`/abdm/consents/${id}`).expect(200)).body.consent.status).toBe('REQUESTED');
  });

  test('an expired consent shows EXPIRED and cannot be approved', async () => {
    const { as, repo, child } = await verifiedChild();
    const id = (await requestConsent(as, child.id).expect(201)).body.consent.id;
    repo.consents.get(id).expiresAt = new Date(Date.now() - 1000).toISOString();
    expect((await as().get(`/abdm/consents/${id}`).expect(200)).body.consent.status).toBe('EXPIRED');
    const res = await as().post(`/abdm/consents/${id}/approve`).expect(403);
    expect(res.body.error.code).toBe('CONSENT_EXPIRED');
  });

  test('revocation takes effect immediately for data access', async () => {
    const { as, repo, child } = await verifiedChild();
    const id = (await requestConsent(as, child.id).expect(201)).body.consent.id;
    const service = createAbdmService({ repo, gateway: createMockGateway(), config: TEST_CONFIG });
    await expect(service.assertConsentUsable(id, child.id)).rejects.toMatchObject({ code: 'CONSENT_NOT_GRANTED' });
    await as().post(`/abdm/consents/${id}/approve`).expect(200);
    await expect(service.assertConsentUsable(id, child.id)).resolves.toBeTruthy();
    await as().post(`/abdm/consents/${id}/revoke`).expect(200);
    await expect(service.assertConsentUsable(id, child.id)).rejects.toMatchObject({ code: 'CONSENT_NOT_GRANTED' });
  });
});

describe('ABDM mock: gateway error scenarios', () => {
  // 5xx responses are logged with console.error by design; keep the test output readable.
  beforeAll(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterAll(() => console.error.mockRestore());

  test.each([
    ['invalid_auth', 401, 'GATEWAY_UNAUTHORIZED'],
    ['invalid_request', 400, 'GATEWAY_INVALID_REQUEST'],
    ['consent_denied', 403, 'CONSENT_DENIED'],
    ['consent_expired', 403, 'CONSENT_EXPIRED'],
    ['consent_revoked', 403, 'CONSENT_REVOKED'],
  ])('%s -> %i %s', async (scenario, status, code) => {
    const { as, child } = await verifiedChild();
    const res = await requestConsent(as, child.id, consentInput, { 'X-Mock-Scenario': scenario }).expect(status);
    expect(res.body.error.code).toBe(code);
  });

  test('timeout and unavailable give up after a bounded number of attempts', async () => {
    const { as, child } = await verifiedChild();
    const timeout = await requestConsent(as, child.id, consentInput, { 'X-Mock-Scenario': 'timeout' }).expect(504);
    expect(timeout.body.error.details).toMatchObject({ attempts: 3, gaveUp: true });
    await requestConsent(as, child.id, consentInput, { 'X-Mock-Scenario': 'unavailable' }).expect(503);
    // The failed attempts must not have created anything.
    expect((await as().get(`/abdm/children/${child.id}/consents`).expect(200)).body.consents).toHaveLength(0);
  });

  test('transient_failure succeeds on the second attempt and creates exactly one consent', async () => {
    const { as, child } = await verifiedChild();
    const res = await requestConsent(as, child.id, consentInput, { 'X-Mock-Scenario': 'transient_failure' }).expect(201);
    expect(res.body.gatewayAttempts).toBe(2);
    expect((await as().get(`/abdm/children/${child.id}/consents`).expect(200)).body.consents).toHaveLength(1);
  });

  test('duplicate_callback on approve is processed once and flagged', async () => {
    const { as, child } = await verifiedChild();
    const id = (await requestConsent(as, child.id).expect(201)).body.consent.id;
    const res = await as().post(`/abdm/consents/${id}/approve`).set('X-Mock-Scenario', 'duplicate_callback').expect(200);
    expect(res.body).toMatchObject({ duplicateCallbackIgnored: true, changed: true });
    expect(res.body.consent.status).toBe('GRANTED');
  });

  test('duplicate_callback is refused for operations that are not idempotent', async () => {
    const { as, child } = await verifiedChild();
    const res = await requestConsent(as, child.id, consentInput, { 'X-Mock-Scenario': 'duplicate_callback' }).expect(400);
    expect(res.body.error.code).toBe('SCENARIO_NOT_SUPPORTED');
  });

  test('a scenario does not bypass ownership checks', async () => {
    const { as, child } = await verifiedChild();
    await as(ROHIT)
      .post(`/abdm/children/${child.id}/consents`)
      .set('X-Mock-Scenario', 'transient_failure')
      .send(consentInput)
      .expect(404);
  });
});
