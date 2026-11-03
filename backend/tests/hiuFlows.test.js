const request = require('supertest');
const { createHash, randomUUID } = require('crypto');
const { createApp } = require('../src/app');
const { MemoryRepository } = require('../src/repositories/memoryRepository');
const { createSender } = require('../src/abdm/fidelius');
const { TEST_CONFIG, authedRequest, NEHA, ROHIT } = require('./helpers/auth');

// M3 as a HIU. ABDM and the HIP are played by the tests: they answer the callbacks, then encrypt a bundle for the key
// the HIU sent and push it to the data push URL. All ids are made up.
const HIU = 'IN0000000088';
const ABHA = 'test.person@sbx';
const BASE = 'https://bridge.example.org';
const child = { name: 'Aarav Sharma', dateOfBirth: '2024-03-15', guardianName: 'Neha Sharma', state: 'Maharashtra', consentStatus: 'granted' };
const consentBody = { abhaAddress: ABHA, purposeCode: 'CAREMGT', dateFrom: '2024-01-01', dateTo: '2025-01-01', dataEraseAt: '2099-01-01T00:00:00.000Z' };
const BUNDLE = { resourceType: 'Bundle', type: 'document', entry: [{ resource: { resourceType: 'Immunization', note: [{ text: 'BCG from another hospital' }] } }] };

const setup = async ({ facilities = [{ serviceId: HIU, hipName: 'TestHiu', type: 'HIU' }], publicBaseUrl = BASE } = {}) => {
  const repo = new MemoryRepository();
  const calls = [];
  const rec = (name) => jest.fn(async (a) => { calls.push([name, a]); return { accepted: true }; });
  const hipClient = {
    consentInit: rec('consentInit'), consentStatus: rec('consentStatus'), consentFetch: rec('consentFetch'),
    requestHealthInformation: rec('requestHealthInformation'), onHiuConsentNotify: rec('onHiuConsentNotify'), notifyDataFlow: rec('notifyDataFlow'),
  };
  const tasks = [];
  const logs = [];
  const spies = ['warn', 'error'].map((m) => jest.spyOn(console, m).mockImplementation((l) => logs.push(String(l))));
  const app = createApp({ repo, logRequests: false, config: TEST_CONFIG, bridge: { facilities: () => facilities, hipClient, publicBaseUrl, defer: (fn) => { tasks.push(fn()); } } });
  const as = (g = NEHA) => authedRequest(app, g);
  const id = (await as().post('/children').send(child).expect(201)).body.id;
  const abdm = (path, body, headers = {}) => request(app).post(path).set({ Authorization: 'Bearer abdm', 'X-HIU-ID': HIU, 'REQUEST-ID': randomUUID(), ...headers }).send(body);
  const settle = async () => { await Promise.all(tasks.splice(0)); };
  const sent = (name) => calls.filter(([n]) => n === name).map(([, a]) => a);
  return { app, as, id, abdm, settle, sent, calls, logs, restore: () => spies.forEach((s) => s.mockRestore()) };
};

// Walks: consent init -> on-init -> notify GRANTED with the given artefacts. Returns the local request id.
async function granted(ctx, artefacts = ['A1']) {
  const created = await ctx.as().post(`/hiu/children/${ctx.id}/consent-requests`).send(consentBody).expect(202);
  const localId = created.body.id;
  await ctx.abdm('/api/v3/hiu/consent/request/on-init', { consentRequest: { id: 'CR1' }, response: { requestId: ctx.sent('consentInit')[0].requestId } }).expect(202);
  await ctx.abdm('/api/v3/hiu/consent/request/notify', { notification: { consentRequestId: 'CR1', status: 'GRANTED', reason: null, consentArtefacts: artefacts.map((a) => ({ id: a })) } }).expect(202);
  await ctx.settle();
  return localId;
}

// Fetch every artefact, answer the first fetch(es) with a granted detail, return the data push request(s).
async function fetchAndRequest(ctx, localId, { hipId = 'IN0000000077', status = 'GRANTED', consentId } = {}) {
  await ctx.as().post(`/hiu/children/${ctx.id}/consent-requests/${localId}/fetch`).send().expect(202);
  const fetches = ctx.sent('consentFetch');
  for (const f of fetches) {
    await ctx.abdm('/api/v3/hiu/consent/on-fetch', {
      consent: { status, consentDetail: { consentId: consentId || f.body.consentId, hip: { id: hipId }, hiTypes: ['ImmunizationRecord'], permission: { dateRange: { from: '2024-01-01T00:00:00.000Z', to: '2025-01-01T00:00:00.000Z' }, dataEraseAt: '2099-01-01T00:00:00.000Z' } }, signature: 'not-checked-here' },
      response: { requestId: f.requestId },
    }).expect(202);
  }
  await ctx.settle();
  return ctx.sent('requestHealthInformation');
}

const pushPath = (req) => new URL(req.body.hiRequest.dataPushUrl).pathname;
const entryFor = (hiRequest, plain = JSON.stringify(BUNDLE), over = {}) => {
  const sender = createSender(hiRequest.body.hiRequest.keyMaterial);
  return { sender, entry: { content: sender.encrypt(plain), media: 'application/fhir+json', checksum: createHash('md5').update(plain).digest('hex'), careContextReference: 'cc-1', ...over } };
};
const page = (hiRequest, entries, sender, over = {}) => ({ pageNumber: 1, pageCount: 1, transactionId: 'T1', entries, keyMaterial: sender.keyMaterial, ...over });

describe('consent request', () => {
  test('is sent for the child\'s ABHA address with our HIU id, and the callback gives it its ABDM id', async () => {
    const ctx = await setup();
    try {
      const localId = await granted(ctx);
      expect(ctx.sent('consentInit')[0].body.consent).toMatchObject({
        patient: { id: ABHA }, hip: null, hiu: { id: HIU }, purpose: { code: 'CAREMGT' }, hiTypes: ['ImmunizationRecord'],
        permission: { accessMode: 'VIEW', dataEraseAt: '2099-01-01T00:00:00.000Z' },
      });
      const list = (await ctx.as().get(`/hiu/children/${ctx.id}/consent-requests`).expect(200)).body.consentRequests;
      expect(list).toEqual([expect.objectContaining({ id: localId, status: 'GRANTED', abdmConsentRequestId: 'CR1' })]);
      expect(ctx.sent('onHiuConsentNotify')[0].body).toMatchObject({ acknowledgement: [{ status: 'OK', consentId: 'A1' }] });
    } finally { ctx.restore(); }
  });

  test('every artefact is kept, not just the first (one per HIP)', async () => {
    const ctx = await setup();
    try {
      await granted(ctx, ['A1', 'A2', 'A3']);
      const [r] = (await ctx.as().get(`/hiu/children/${ctx.id}/consent-requests`)).body.consentRequests;
      expect(r.artefacts.map((a) => a.id)).toEqual(['A1', 'A2', 'A3']);
      expect(ctx.sent('onHiuConsentNotify')[0].body.acknowledgement).toHaveLength(3);
    } finally { ctx.restore(); }
  });

  test('is validated, needs an HIU facility, and only the owning guardian can use a child', async () => {
    const ctx = await setup();
    const none = await setup({ facilities: [] });
    try {
      await ctx.as().post(`/hiu/children/${ctx.id}/consent-requests`).send({ ...consentBody, purposeCode: 'NOPE' }).expect(400);
      await ctx.as().post(`/hiu/children/${ctx.id}/consent-requests`).send({ ...consentBody, abhaAddress: 'bad' }).expect(400);
      await ctx.as().post(`/hiu/children/${ctx.id}/consent-requests`).send({ ...consentBody, dateFrom: '2026-01-01', dateTo: '2025-01-01' }).expect(400);
      await ctx.as().post(`/hiu/children/${ctx.id}/consent-requests`).send({ ...consentBody, dataEraseAt: '2001-01-01T00:00:00.000Z' }).expect(400);
      await ctx.as(ROHIT).post(`/hiu/children/${ctx.id}/consent-requests`).send(consentBody).expect(404);
      expect(ctx.sent('consentInit')).toHaveLength(0);
      const res = await none.as().post(`/hiu/children/${none.id}/consent-requests`).send(consentBody).expect(409);
      expect(res.body.error.code).toBe('NO_HIU_FACILITY');
    } finally { ctx.restore(); none.restore(); }
  });

  test('a refused consent init is reported with ABDM\'s own code', async () => {
    const ctx = await setup();
    try {
      const created = await ctx.as().post(`/hiu/children/${ctx.id}/consent-requests`).send(consentBody).expect(202);
      await ctx.abdm('/api/v3/hiu/consent/request/on-init', { error: { code: 'ABDM-1051', message: 'Invalid ABHA Number or ABHA Address' }, response: { requestId: ctx.sent('consentInit')[0].requestId } }).expect(202);
      const [r] = (await ctx.as().get(`/hiu/children/${ctx.id}/consent-requests`)).body.consentRequests;
      expect(r).toMatchObject({ id: created.body.id, status: 'FAILED', error: { code: 'ABDM-1051' } });
    } finally { ctx.restore(); }
  });

  test('a notification for a request we do not know, or with an unknown status, is dropped', async () => {
    const ctx = await setup();
    try {
      await granted(ctx);
      await ctx.abdm('/api/v3/hiu/consent/request/notify', { notification: { consentRequestId: 'OTHER', status: 'GRANTED', reason: null, consentArtefacts: [{ id: 'X' }] } }).expect(202);
      await ctx.abdm('/api/v3/hiu/consent/request/notify', { notification: { consentRequestId: 'CR1', status: 'MAYBE', reason: null, consentArtefacts: [] } }).expect(202);
      await ctx.settle();
      expect(ctx.sent('onHiuConsentNotify')).toHaveLength(1);
    } finally { ctx.restore(); }
  });

  test('a repeated notification (same REQUEST-ID) is acknowledged once', async () => {
    const ctx = await setup();
    try {
      await ctx.as().post(`/hiu/children/${ctx.id}/consent-requests`).send(consentBody).expect(202);
      await ctx.abdm('/api/v3/hiu/consent/request/on-init', { consentRequest: { id: 'CR1' }, response: { requestId: ctx.sent('consentInit')[0].requestId } });
      const rid = randomUUID();
      const n = { notification: { consentRequestId: 'CR1', status: 'GRANTED', reason: null, consentArtefacts: [{ id: 'A1' }] } };
      await ctx.abdm('/api/v3/hiu/consent/request/notify', n, { 'REQUEST-ID': rid }).expect(202);
      await ctx.abdm('/api/v3/hiu/consent/request/notify', n, { 'REQUEST-ID': rid }).expect(202);
      await ctx.settle();
      expect(ctx.sent('onHiuConsentNotify')).toHaveLength(1);
    } finally { ctx.restore(); }
  });
});

describe('fetching and receiving the records', () => {
  test('fetch each artefact -> request records with our key and a one-time push URL -> decrypt -> notify RECEIVED', async () => {
    const ctx = await setup();
    try {
      const localId = await granted(ctx, ['A1', 'A2']);
      const requests = await fetchAndRequest(ctx, localId);
      expect(ctx.sent('consentFetch').map((f) => f.body.consentId)).toEqual(['A1', 'A2']); // one fetch per artefact
      expect(requests).toHaveLength(2);

      const [first] = requests;
      expect(first.hiuId).toBe(HIU);
      expect(first.body.hiRequest).toMatchObject({ consent: { id: 'A1' }, dateRange: { from: '2024-01-01T00:00:00.000Z' }, keyMaterial: { cryptoAlg: 'ECDH', curve: 'curve25519' } });
      expect(first.body.hiRequest.dataPushUrl).toMatch(new RegExp(`^${BASE}/api/v3/hiu/data-push/[0-9a-f]{48}$`));
      expect(requests[1].body.hiRequest.dataPushUrl).not.toBe(first.body.hiRequest.dataPushUrl);

      await ctx.abdm('/api/v3/hiu/health-information/on-request', { hiRequest: { transactionId: 'T1', sessionStatus: 'REQUESTED' }, response: { requestId: first.requestId } }).expect(202);

      const { sender, entry } = entryFor(first);
      await request(ctx.app).post(pushPath(first)).set('Authorization', 'Bearer hip-token').send(page(first, [entry], sender)).expect(202);
      await ctx.settle();

      const notice = ctx.sent('notifyDataFlow')[0].body.notification;
      expect(notice).toMatchObject({ consentId: 'A1', transactionId: 'T1', notifier: { type: 'HIU', id: HIU }, statusNotification: { sessionStatus: 'RECEIVED', hipId: 'IN0000000077', statusResponses: [{ careContextReference: 'cc-1', hiStatus: 'OK' }] } });

      const { records } = (await ctx.as().get(`/hiu/children/${ctx.id}/records`).expect(200)).body;
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ artefactId: 'A1', hipId: 'IN0000000077', careContextReference: 'cc-1', bundle: BUNDLE });
    } finally { ctx.restore(); }
  });

  test('a push is refused without a bearer token, to an unknown address, for the wrong transaction, and after it completed', async () => {
    const ctx = await setup();
    try {
      const [first] = await fetchAndRequest(ctx, await granted(ctx));
      await ctx.abdm('/api/v3/hiu/health-information/on-request', { hiRequest: { transactionId: 'T1', sessionStatus: 'REQUESTED' }, response: { requestId: first.requestId } });
      const { sender, entry } = entryFor(first);
      await request(ctx.app).post(pushPath(first)).send(page(first, [entry], sender)).expect(401);
      await request(ctx.app).post('/api/v3/hiu/data-push/deadbeef').set('Authorization', 'Bearer t').send(page(first, [entry], sender)).expect(404);
      await request(ctx.app).post(pushPath(first)).set('Authorization', 'Bearer t').send(page(first, [entry], sender, { transactionId: 'OTHER' })).expect(400);
      await request(ctx.app).post(pushPath(first)).set('Authorization', 'Bearer t').send({ entries: 'nope' }).expect(400);
      await request(ctx.app).post(pushPath(first)).set('Authorization', 'Bearer t').send(page(first, [entry], sender)).expect(202);
      await request(ctx.app).post(pushPath(first)).set('Authorization', 'Bearer t').send(page(first, [entry], sender)).expect(404); // used once
      await ctx.settle();
      expect(ctx.sent('notifyDataFlow')).toHaveLength(1);
    } finally { ctx.restore(); }
  });

  test('a record that fails its checksum or cannot be decrypted is not kept, and FAILED is reported', async () => {
    const ctx = await setup();
    try {
      const [first] = await fetchAndRequest(ctx, await granted(ctx));
      const { sender, entry } = entryFor(first, JSON.stringify(BUNDLE), { checksum: 'deadbeef' });
      await request(ctx.app).post(pushPath(first)).set('Authorization', 'Bearer t').send(page(first, [entry], sender)).expect(202);
      await ctx.settle();
      expect(ctx.sent('notifyDataFlow')[0].body.notification.statusNotification).toMatchObject({ sessionStatus: 'FAILED', statusResponses: [{ hiStatus: 'ERRORED' }] });
      expect((await ctx.as().get(`/hiu/children/${ctx.id}/records`)).body.records).toHaveLength(0);
      expect(JSON.stringify(ctx.logs)).not.toContain('BCG from another hospital');
    } finally { ctx.restore(); }
  });

  test('a bundle that is not FHIR is refused', async () => {
    const ctx = await setup();
    try {
      const [first] = await fetchAndRequest(ctx, await granted(ctx));
      const { sender, entry } = entryFor(first, JSON.stringify({ hello: 'world' }));
      await request(ctx.app).post(pushPath(first)).set('Authorization', 'Bearer t').send(page(first, [entry], sender)).expect(202);
      await ctx.settle();
      expect(ctx.sent('notifyDataFlow')[0].body.notification.statusNotification.sessionStatus).toBe('FAILED');
      expect((await ctx.as().get(`/hiu/children/${ctx.id}/records`)).body.records).toHaveLength(0);
    } finally { ctx.restore(); }
  });

  test('records encrypted with key material that does not match are refused', async () => {
    const ctx = await setup();
    try {
      const [first] = await fetchAndRequest(ctx, await granted(ctx));
      const { entry } = entryFor(first);
      const stranger = createSender(first.body.hiRequest.keyMaterial); // another key pair and nonce than the entry used
      await request(ctx.app).post(pushPath(first)).set('Authorization', 'Bearer t').send(page(first, [entry], stranger)).expect(202);
      await ctx.settle();
      expect(ctx.sent('notifyDataFlow')[0].body.notification.statusNotification.sessionStatus).toBe('FAILED');
      expect((await ctx.as().get(`/hiu/children/${ctx.id}/records`)).body.records).toHaveLength(0);
    } finally { ctx.restore(); }
  });

  test('records arriving over two pages are reported once, after the last page, and a repeated page is ignored', async () => {
    const ctx = await setup();
    try {
      const [first] = await fetchAndRequest(ctx, await granted(ctx));
      const a = entryFor(first, JSON.stringify(BUNDLE), { careContextReference: 'cc-1' });
      const send = (pageNumber, e, sender) => request(ctx.app).post(pushPath(first)).set('Authorization', 'Bearer t').send(page(first, [e], sender, { pageNumber, pageCount: 2 }));
      await send(1, a.entry, a.sender).expect(202);
      await send(1, a.entry, a.sender).expect(202); // repeat
      await ctx.settle();
      expect(ctx.sent('notifyDataFlow')).toHaveLength(0);
      const b = entryFor(first, JSON.stringify(BUNDLE), { careContextReference: 'cc-2' });
      await send(2, b.entry, b.sender).expect(202);
      await ctx.settle();
      expect(ctx.sent('notifyDataFlow')).toHaveLength(1);
      expect((await ctx.as().get(`/hiu/children/${ctx.id}/records`)).body.records.map((r) => r.careContextReference)).toEqual(['cc-1', 'cc-2']);
    } finally { ctx.restore(); }
  });
});

describe('what is never requested or kept', () => {
  test.each([['REVOKED'], ['EXPIRED']])('no records are requested for an artefact that is %s', async (status) => {
    const ctx = await setup();
    try {
      const requests = await fetchAndRequest(ctx, await granted(ctx), { status });
      expect(requests).toHaveLength(0);
    } finally { ctx.restore(); }
  });

  test('an artefact detail for a different consent id is not trusted', async () => {
    const ctx = await setup();
    try {
      expect(await fetchAndRequest(ctx, await granted(ctx), { consentId: 'SOMETHING-ELSE' })).toHaveLength(0);
    } finally { ctx.restore(); }
  });

  test('a revocation drops the records held and refuses a later push', async () => {
    const ctx = await setup();
    try {
      const localId = await granted(ctx);
      const [first] = await fetchAndRequest(ctx, localId);
      const { sender, entry } = entryFor(first);
      await request(ctx.app).post(pushPath(first)).set('Authorization', 'Bearer t').send(page(first, [entry], sender)).expect(202);
      expect((await ctx.as().get(`/hiu/children/${ctx.id}/records`)).body.records).toHaveLength(1);

      await ctx.abdm('/api/v3/hiu/consent/request/notify', { notification: { consentRequestId: 'CR1', status: 'REVOKED', reason: null, consentArtefacts: [{ id: 'A1' }] } }).expect(202);
      await ctx.settle();
      expect((await ctx.as().get(`/hiu/children/${ctx.id}/records`)).body.records).toHaveLength(0);
      await request(ctx.app).post(pushPath(first)).set('Authorization', 'Bearer t').send(page(first, [entry], sender)).expect(404);
    } finally { ctx.restore(); }
  });

  test('a push for an artefact revoked before the records arrive is refused', async () => {
    const ctx = await setup();
    try {
      const [first] = await fetchAndRequest(ctx, await granted(ctx));
      await ctx.abdm('/api/v3/hiu/consent/request/notify', { notification: { consentRequestId: 'CR1', status: 'REVOKED', reason: null, consentArtefacts: [{ id: 'A1' }] } });
      const { sender, entry } = entryFor(first);
      await request(ctx.app).post(pushPath(first)).set('Authorization', 'Bearer t').send(page(first, [entry], sender)).expect(403);
      expect((await ctx.as().get(`/hiu/children/${ctx.id}/records`)).body.records).toHaveLength(0);
    } finally { ctx.restore(); }
  });

  test('records past the artefact\'s erase time are no longer returned', async () => {
    const ctx = await setup();
    try {
      const localId = await granted(ctx);
      await fetchAndRequest(ctx, localId);
      // simulate an artefact whose erase time has passed: fetch again and answer with the past time
      await ctx.as().post(`/hiu/children/${ctx.id}/consent-requests/${localId}/fetch`).send().expect(202);
      const again = ctx.sent('consentFetch').at(-1);
      await ctx.abdm('/api/v3/hiu/consent/on-fetch', { consent: { status: 'GRANTED', consentDetail: { consentId: 'A1', hip: { id: 'IN0000000077' }, permission: { dateRange: { from: '2024-01-01T00:00:00.000Z', to: '2025-01-01T00:00:00.000Z' }, dataEraseAt: '2001-01-01T00:00:00.000Z' } } }, response: { requestId: again.requestId } });
      await ctx.settle();
      const second = ctx.sent('requestHealthInformation').at(-1);
      const { sender, entry } = entryFor(second);
      await request(ctx.app).post(pushPath(second)).set('Authorization', 'Bearer t').send(page(second, [entry], sender)).expect(202);
      expect((await ctx.as().get(`/hiu/children/${ctx.id}/records`)).body.records).toHaveLength(0);
    } finally { ctx.restore(); }
  });

  test('without a public https address no data request is sent and the artefact shows the reason', async () => {
    const ctx = await setup({ publicBaseUrl: '' });
    try {
      const localId = await granted(ctx);
      expect(await fetchAndRequest(ctx, localId)).toHaveLength(0);
      const [r] = (await ctx.as().get(`/hiu/children/${ctx.id}/consent-requests`)).body.consentRequests;
      expect(r.artefacts[0].error.code).toBe('NO_PUBLIC_URL');
    } finally { ctx.restore(); }
  });
});

describe('the guard covers every inbound HIU route', () => {
  test.each([
    '/api/v3/hiu/consent/request/on-init', '/api/v3/hiu/consent/request/on-status', '/api/v3/hiu/consent/on-fetch',
    '/api/v3/hiu/health-information/on-request', '/api/v3/hiu/consent/request/notify',
  ])('%s: no bearer token -> 401, wrong facility -> 403, nothing sent', async (path) => {
    const ctx = await setup();
    try {
      await request(ctx.app).post(path).set({ 'X-HIU-ID': HIU, 'REQUEST-ID': randomUUID() }).send({}).expect(401);
      await request(ctx.app).post(path).set({ Authorization: 'Bearer t', 'X-HIU-ID': 'IN9999999999', 'REQUEST-ID': randomUUID() }).send({}).expect(403);
      await ctx.settle();
      expect(ctx.calls).toHaveLength(0);
    } finally { ctx.restore(); }
  });

  test('an answer is accepted only for the kind of call it answers', async () => {
    const ctx = await setup();
    try {
      await ctx.as().post(`/hiu/children/${ctx.id}/consent-requests`).send(consentBody).expect(202);
      // the id of a consent-init call, offered to the on-fetch route
      await ctx.abdm('/api/v3/hiu/consent/on-fetch', { consent: { status: 'GRANTED' }, response: { requestId: ctx.sent('consentInit')[0].requestId } }).expect(202);
      await ctx.settle();
      expect(ctx.sent('requestHealthInformation')).toHaveLength(0);
    } finally { ctx.restore(); }
  });
});
