const request = require('supertest');
const { createApp } = require('../src/app');
const { MemoryRepository } = require('../src/repositories/memoryRepository');
const { createPendingRequests } = require('../src/abdm/bridge/pendingRequests');
const { TEST_CONFIG, authedRequest, NEHA, ROHIT } = require('./helpers/auth');

// M2 as a HIP, HIP-initiated linking: link token, then care context. ABDM is a fake client; the facility id
// is a made-up test value; the bridge callbacks are posted by the tests.
const HIP = 'IN0000000099';
const ABHA = 'test.person@sbx';
const LINK_TOKEN = 'SECRET-LINK-TOKEN';
const child = { name: 'Aarav Sharma', dateOfBirth: '2024-03-15', guardianName: 'Neha Sharma', state: 'Maharashtra', consentStatus: 'granted' };

const setup = async ({ facilities = [{ serviceId: HIP, hipName: 'TestHip', type: 'HIP' }] } = {}) => {
  const repo = new MemoryRepository();
  const sent = [];
  const hipClient = {
    generateLinkToken: jest.fn(async (a) => { sent.push(['token', a]); return { accepted: true }; }),
    linkCareContext: jest.fn(async (a) => { sent.push(['link', a]); return { accepted: true }; }),
  };
  const pending = createPendingRequests();
  const logs = [];
  const spy = jest.spyOn(console, 'warn').mockImplementation((l) => logs.push(String(l)));
  const app = createApp({ repo, logRequests: false, config: TEST_CONFIG, bridge: { facilities: () => facilities, hipClient, pending } });
  const as = (g = NEHA) => authedRequest(app, g);
  const id = (await as().post('/children').send(child).expect(201)).body.id;
  const cb = (path, body, headers = { Authorization: 'Bearer abdm-token', 'X-HIP-ID': HIP }) => request(app).post(path).set(headers).send(body);
  return { repo, as, id, app, hipClient, sent, cb, logs, restore: () => spy.mockRestore() };
};

describe('HIP-initiated linking', () => {
  test('token request -> token callback -> link -> result callback', async () => {
    const { as, id, sent, cb, hipClient, restore } = await setup();
    try {
      const t = await as().post(`/hip/children/${id}/link-token`).send({ abhaAddress: ABHA, gender: 'M' }).expect(202);
      expect(t.body.tokenStatus).toBe('WAITING_FOR_CALLBACK');
      const call = sent[0][1];
      expect(call).toMatchObject({ hipId: HIP, body: { abhaAddress: ABHA, name: 'Aarav Sharma', gender: 'M', yearOfBirth: 2024 } });

      // linking before the token arrives is refused
      await as().post(`/hip/children/${id}/link-care-context`).send({ abhaAddress: ABHA }).expect(409);

      await cb('/api/v3/hip/token/on-generate-token', { abhaAddress: ABHA, linkToken: LINK_TOKEN, response: { requestId: call.requestId } }).expect(202);
      expect((await as().get(`/hip/children/${id}/link-status`).expect(200)).body.tokenStatus).toBe('RECEIVED');

      await as().post(`/hip/children/${id}/link-care-context`).send({ abhaAddress: ABHA }).expect(202);
      const link = sent[1][1];
      expect(link.linkToken).toBe(LINK_TOKEN);
      expect(link.body.patient[0]).toMatchObject({ hiType: 'ImmunizationRecord', careContexts: [{ referenceNumber: 'immunization-record' }] });
      expect(hipClient.linkCareContext).toHaveBeenCalledTimes(1);

      await cb('/api/v3/link/on_carecontext', { abhaAddress: ABHA, status: 'Successfully Linked care context', response: { requestId: link.requestId } }).expect(202);
      const st = (await as().get(`/hip/children/${id}/link-status`).expect(200)).body;
      expect(st).toMatchObject({ tokenStatus: 'RECEIVED', linkStatus: 'LINKED' });
      expect(JSON.stringify(st)).not.toContain(LINK_TOKEN);
    } finally { restore(); }
  });

  test('a failure callback is recorded with ABDM\'s own code, and nothing is marked linked', async () => {
    const { as, id, sent, cb, restore } = await setup();
    try {
      await as().post(`/hip/children/${id}/link-token`).send({ abhaAddress: ABHA, gender: 'F' }).expect(202);
      await cb('/api/v3/hip/token/on-generate-token', { error: { code: 'ABDM-1051', message: 'Invalid ABHA Number or ABHA Address' }, response: { requestId: sent[0][1].requestId } }).expect(202);
      const st = (await as().get(`/hip/children/${id}/link-status`)).body;
      expect(st).toMatchObject({ tokenStatus: 'FAILED', linkStatus: 'NONE', error: { code: 'ABDM-1051' } });
    } finally { restore(); }
  });

  test('a link result that is not "Successfully Linked care context" is a failure', async () => {
    const { as, id, sent, cb, restore } = await setup();
    try {
      await as().post(`/hip/children/${id}/link-token`).send({ abhaAddress: ABHA, gender: 'M' }).expect(202);
      await cb('/api/v3/hip/token/on-generate-token', { abhaAddress: ABHA, linkToken: LINK_TOKEN, response: { requestId: sent[0][1].requestId } }).expect(202);
      await as().post(`/hip/children/${id}/link-care-context`).send({ abhaAddress: ABHA }).expect(202);
      await cb('/api/v3/link/on_carecontext', { abhaAddress: ABHA, status: 'Failed to link care context', response: { requestId: sent[1][1].requestId } }).expect(202);
      expect((await as().get(`/hip/children/${id}/link-status`)).body.linkStatus).toBe('FAILED');
    } finally { restore(); }
  });
});

describe('the callback guard', () => {
  test('rejects a callback with no bearer token before anything is read, and logs it', async () => {
    const { as, id, sent, cb, logs, restore } = await setup();
    try {
      await as().post(`/hip/children/${id}/link-token`).send({ abhaAddress: ABHA, gender: 'M' }).expect(202);
      const body = { abhaAddress: ABHA, linkToken: LINK_TOKEN, response: { requestId: sent[0][1].requestId } };
      await cb('/api/v3/hip/token/on-generate-token', body, { 'X-HIP-ID': HIP }).expect(401);
      await cb('/api/v3/hip/token/on-generate-token', body, { Authorization: 'Basic abc', 'X-HIP-ID': HIP }).expect(401);
      expect((await as().get(`/hip/children/${id}/link-status`)).body.tokenStatus).toBe('WAITING_FOR_CALLBACK');
      expect(logs.join('\n')).toContain('callback_rejected');
      expect(logs.join('\n')).not.toContain(LINK_TOKEN);
    } finally { restore(); }
  });

  test('rejects a callback for a facility that is not ours', async () => {
    const { cb, restore } = await setup();
    try {
      await cb('/api/v3/link/on_carecontext', { response: { requestId: 'x' } }, { Authorization: 'Bearer t', 'X-HIP-ID': 'IN9999999999' }).expect(403);
      await cb('/api/v3/link/on_carecontext', { response: { requestId: 'x' } }, { Authorization: 'Bearer t' }).expect(403);
    } finally { restore(); }
  });

  test('with no facilities configured every callback is refused (fails closed)', async () => {
    const { cb, restore } = await setup({ facilities: [] });
    try {
      await cb('/api/v3/link/on_carecontext', { response: { requestId: 'x' } }).expect(403);
    } finally { restore(); }
  });

  test('drops an unknown request id, and a callback delivered twice is handled once', async () => {
    const { as, id, sent, cb, logs, restore } = await setup();
    try {
      await cb('/api/v3/hip/token/on-generate-token', { abhaAddress: ABHA, linkToken: 'EVIL', response: { requestId: 'never-sent' } }).expect(202);
      expect(logs.join('\n')).toContain('callback_dropped');

      await as().post(`/hip/children/${id}/link-token`).send({ abhaAddress: ABHA, gender: 'M' }).expect(202);
      const rid = sent[0][1].requestId;
      await cb('/api/v3/hip/token/on-generate-token', { abhaAddress: ABHA, linkToken: LINK_TOKEN, response: { requestId: rid } }).expect(202);
      await cb('/api/v3/hip/token/on-generate-token', { abhaAddress: ABHA, linkToken: 'REPLAYED', response: { requestId: rid } }).expect(202);
      await as().post(`/hip/children/${id}/link-care-context`).send({ abhaAddress: ABHA }).expect(202);
      expect(sent[1][1].linkToken).toBe(LINK_TOKEN); // not the replayed one
    } finally { restore(); }
  });

  test('a callback answers only the kind of call it belongs to', async () => {
    const { as, id, sent, cb, restore } = await setup();
    try {
      await as().post(`/hip/children/${id}/link-token`).send({ abhaAddress: ABHA, gender: 'M' }).expect(202);
      // a link-result callback carrying the id of a TOKEN request must not be accepted
      await cb('/api/v3/link/on_carecontext', { abhaAddress: ABHA, status: 'Successfully Linked care context', response: { requestId: sent[0][1].requestId } }).expect(202);
      expect((await as().get(`/hip/children/${id}/link-status`)).body.linkStatus).toBe('NONE');
    } finally { restore(); }
  });
});

describe('guardian-facing API', () => {
  test('needs a configured HIP facility and the sandbox client', async () => {
    const { as, id, restore } = await setup({ facilities: [] });
    try {
      const res = await as().post(`/hip/children/${id}/link-token`).send({ abhaAddress: ABHA, gender: 'M' }).expect(409);
      expect(res.body.error.code).toBe('NO_HIP_FACILITY');
    } finally { restore(); }
  });

  test('validates the ABHA address and gender, and only the owner can use a child', async () => {
    const { as, id, hipClient, restore } = await setup();
    try {
      await as().post(`/hip/children/${id}/link-token`).send({ abhaAddress: 'nodomain', gender: 'M' }).expect(400);
      await as().post(`/hip/children/${id}/link-token`).send({ abhaAddress: ABHA, gender: 'X' }).expect(400);
      await as(ROHIT).post(`/hip/children/${id}/link-token`).send({ abhaAddress: ABHA, gender: 'M' }).expect(404);
      expect(hipClient.generateLinkToken).not.toHaveBeenCalled();
    } finally { restore(); }
  });

  test('a refused outbound call leaves nothing waiting and reports ABDM\'s answer', async () => {
    const { as, id, hipClient, restore } = await setup();
    try {
      const { AppError } = require('../src/errors');
      hipClient.generateLinkToken.mockRejectedValueOnce(new AppError(404, 'ABDM_REFUSED', 'Invalid HIP ID', { abdmCode: 'ABDM-1035' }));
      const res = await as().post(`/hip/children/${id}/link-token`).send({ abhaAddress: ABHA, gender: 'M' }).expect(404);
      expect(res.body.error.details.abdmCode).toBe('ABDM-1035');
      expect((await as().get(`/hip/children/${id}/link-status`)).body.tokenStatus).toBe('NONE');
    } finally { restore(); }
  });

  test('the link token is not in any response or audit event', async () => {
    const { as, id, sent, cb, repo, restore } = await setup();
    try {
      const r1 = await as().post(`/hip/children/${id}/link-token`).send({ abhaAddress: ABHA, gender: 'M' });
      await cb('/api/v3/hip/token/on-generate-token', { abhaAddress: ABHA, linkToken: LINK_TOKEN, response: { requestId: sent[0][1].requestId } });
      const r2 = await as().post(`/hip/children/${id}/link-care-context`).send({ abhaAddress: ABHA });
      const everything = JSON.stringify([r1.body, r2.body, repo.auditEvents]);
      expect(everything).toContain('HIP_LINK_TOKEN_REQUEST');
      expect(everything).not.toContain(LINK_TOKEN);
    } finally { restore(); }
  });
});
