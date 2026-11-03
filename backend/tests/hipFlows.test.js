const request = require('supertest');
const { createHash, randomUUID } = require('crypto');
const { createApp } = require('../src/app');
const { MemoryRepository } = require('../src/repositories/memoryRepository');
const { createReceiver } = require('../src/abdm/fidelius');
const { TEST_CONFIG, authedRequest, NEHA } = require('./helpers/auth');

// M2 as a HIP, the rest: user-initiated linking, consent notification, health-information request and the
// encrypted push. ABDM is a fake client, so the tests read what we would have sent. The requester's side of the
// encryption is played by the tests. All ids are made up.
const HIP = 'IN0000000099';
const ABHA = 'test.person@sbx';
const child = { name: 'Aarav Sharma', dateOfBirth: '2024-03-15', guardianName: 'Neha Sharma', state: 'Maharashtra', consentStatus: 'granted' };
const AUTH = { Authorization: 'Bearer abdm-token', 'X-HIP-ID': HIP };

const setup = async ({ childOverrides = {} } = {}) => {
  const repo = new MemoryRepository();
  const calls = [];
  const rec = (name) => jest.fn(async (a) => { calls.push([name, a]); return { accepted: true }; });
  const hipClient = {
    generateLinkToken: rec('generateLinkToken'), linkCareContext: rec('linkCareContext'),
    onDiscover: rec('onDiscover'), onLinkInit: rec('onLinkInit'), onLinkConfirm: rec('onLinkConfirm'),
    onConsentNotify: rec('onConsentNotify'), onHealthInformationRequest: rec('onHealthInformationRequest'),
    notifyDataFlow: rec('notifyDataFlow'), pushRecords: jest.fn(async (url, body) => { calls.push(['push', { url, body }]); return { status: 202 }; }),
  };
  const tasks = [];
  const logs = [];
  const spy = ['warn', 'error'].map((m) => jest.spyOn(console, m).mockImplementation((l) => logs.push(String(l))));
  const app = createApp({
    repo, logRequests: false, config: TEST_CONFIG,
    bridge: { facilities: () => [{ serviceId: HIP, hipName: 'TestHip', type: 'HIP' }], hipClient, defer: (fn) => { tasks.push(fn()); } },
  });
  const as = () => authedRequest(app, NEHA);
  const created = (await as().post('/children').send({ ...child, ...childOverrides }).expect(201)).body;
  const post = (path, body, headers = {}) => request(app).post(path).set({ ...AUTH, 'REQUEST-ID': randomUUID(), ...headers }).send(body);
  const settle = async () => { await Promise.all(tasks.splice(0)); };
  const sent = (name) => calls.filter(([n]) => n === name).map(([, a]) => a);
  return { repo, as, id: created.id, post, settle, sent, calls, logs, restore: () => spy.forEach((s) => s.mockRestore()), app };
};

describe('user-initiated linking', () => {
  test('discovery finds an unlinked child by ABHA address, name and year of birth, and answers with that request id', async () => {
    const { as, id, post, settle, sent, restore } = await setup();
    try {
      await as().post(`/hip/children/${id}/abha-address`).send({ abhaAddress: ABHA }).expect(200);
      const rid = randomUUID();
      const body = { transactionId: randomUUID(), patient: { id: ABHA, name: 'AARAV SHARMA', gender: 'M', yearOfBirth: 2024, verifiedIdentifiers: [{ type: 'ABHA_ADDRESS', value: ABHA }] } };
      await post('/api/v3/hip/patient/care-context/discover', body, { 'REQUEST-ID': rid }).expect(202);
      await settle();
      const [reply] = sent('onDiscover');
      expect(reply.hiuId).toBe(HIP);
      expect(reply.body).toMatchObject({ transactionId: body.transactionId, matchedBy: ['ABHA_ADDRESS'], response: { requestId: rid } });
      expect(reply.body.patient[0]).toMatchObject({ referenceNumber: id, hiType: 'ImmunizationRecord', count: 1, careContexts: [{ referenceNumber: 'immunization-record' }] });
    } finally { restore(); }
  });

  test.each([
    ['another name', { name: 'Someone Else', yearOfBirth: 2024 }],
    ['another year of birth', { name: 'Aarav Sharma', yearOfBirth: 1999 }],
  ])('no match for %s: answers with an error, never a record', async (_label, who) => {
    const { as, id, post, settle, sent, restore } = await setup();
    try {
      await as().post(`/hip/children/${id}/abha-address`).send({ abhaAddress: ABHA }).expect(200);
      await post('/api/v3/hip/patient/care-context/discover', { transactionId: randomUUID(), patient: { id: ABHA, gender: 'M', verifiedIdentifiers: [], ...who } }).expect(202);
      await settle();
      expect(sent('onDiscover')[0].body.patient).toBeUndefined();
      expect(sent('onDiscover')[0].body.error.message).toBe('No matching record found');
    } finally { restore(); }
  });

  test('a child whose guardian has not consented is not discoverable', async () => {
    const { as, id, post, settle, sent, restore } = await setup({ childOverrides: { consentStatus: 'pending' } });
    try {
      await as().post(`/hip/children/${id}/abha-address`).send({ abhaAddress: ABHA }).expect(200);
      await post('/api/v3/hip/patient/care-context/discover', { transactionId: randomUUID(), patient: { id: ABHA, name: 'Aarav Sharma', gender: 'M', yearOfBirth: 2024, verifiedIdentifiers: [] } });
      await settle();
      expect(sent('onDiscover')[0].body.error).toBeDefined();
    } finally { restore(); }
  });

  test('a repeated delivery of the same request id is answered once', async () => {
    const { post, settle, sent, restore } = await setup();
    try {
      const rid = randomUUID();
      const b = { transactionId: randomUUID(), patient: { id: ABHA, name: 'x', gender: 'M', yearOfBirth: 2000, verifiedIdentifiers: [] } };
      await post('/api/v3/hip/patient/care-context/discover', b, { 'REQUEST-ID': rid }).expect(202);
      await post('/api/v3/hip/patient/care-context/discover', b, { 'REQUEST-ID': rid }).expect(202);
      await settle();
      expect(sent('onDiscover')).toHaveLength(1);
    } finally { restore(); }
  });

  test('init -> code read once by the guardian -> confirm links the care context', async () => {
    const { as, id, post, settle, sent, restore } = await setup();
    try {
      await as().post(`/hip/children/${id}/abha-address`).send({ abhaAddress: ABHA }).expect(200);
      const rid = randomUUID();
      const transactionId = randomUUID();
      await post('/api/v3/hip/link/care-context/init', { transactionId, abhaAddress: ABHA, patient: [{ referenceNumber: id, display: 'x', careContexts: [{ referenceNumber: 'immunization-record', display: 'x' }], hiType: 'ImmunizationRecord', count: 1 }] }, { 'REQUEST-ID': rid }).expect(202);
      await settle();
      const init = sent('onLinkInit')[0].body;
      expect(init).toMatchObject({ transactionId, link: { authenticationType: 'DIRECT', meta: { communicationHint: 'OTP' } }, response: { requestId: rid } });
      const linkRefNumber = init.link.referenceNumber;

      const code = (await as().get(`/hip/children/${id}/link-code`).expect(200)).body.otp;
      expect(code).toMatch(/^\d{6}$/);
      await as().get(`/hip/children/${id}/link-code`).expect(404); // read once

      const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0');
      await post('/api/v3/hip/link/care-context/confirm', { confirmation: { linkRefNumber, token: Number(wrong) } }).expect(202);
      await post('/api/v3/hip/link/care-context/confirm', { confirmation: { linkRefNumber, token: Number(code) } }).expect(202);
      await settle();
      const [bad, good] = sent('onLinkConfirm');
      expect(bad.body.error.message).toBe('The code is incorrect or has expired');
      expect(good.body.patient[0]).toMatchObject({ referenceNumber: id, count: 1 });
      expect((await as().get(`/hip/children/${id}/link-status`)).body.linkStatus).toBe('LINKED');

      // the same code cannot be used again, and a linked care context is no longer offered
      await post('/api/v3/hip/link/care-context/confirm', { confirmation: { linkRefNumber, token: Number(code) } });
      await settle();
      expect(sent('onLinkConfirm')[2].body.error.code).toBe('ABDM-1056');
    } finally { restore(); }
  });

  test('three wrong codes end the attempt, an unknown reference is refused, and the code never reaches logs or audit', async () => {
    const { as, id, post, settle, sent, logs, repo, restore } = await setup();
    try {
      await as().post(`/hip/children/${id}/abha-address`).send({ abhaAddress: ABHA }).expect(200);
      await post('/api/v3/hip/link/care-context/init', { transactionId: randomUUID(), abhaAddress: ABHA, patient: [{ careContexts: [{ referenceNumber: 'immunization-record' }] }] });
      await settle();
      const linkRefNumber = sent('onLinkInit')[0].body.link.referenceNumber;
      const code = (await as().get(`/hip/children/${id}/link-code`)).body.otp;
      const wrong = Number(code) === 111111 ? 222222 : 111111;
      for (let i = 0; i < 3; i += 1) await post('/api/v3/hip/link/care-context/confirm', { confirmation: { linkRefNumber, token: wrong } });
      await post('/api/v3/hip/link/care-context/confirm', { confirmation: { linkRefNumber, token: Number(code) } });
      await post('/api/v3/hip/link/care-context/confirm', { confirmation: { linkRefNumber: randomUUID(), token: 123456 } });
      await settle();
      const answers = sent('onLinkConfirm');
      expect(answers.every((a) => a.body.error)).toBe(true); // even the right code is too late after three wrong ones
      expect(answers[3].body.error.code).toBe('ABDM-1056');
      const everything = JSON.stringify([logs, repo.auditEvents, answers]);
      expect(everything).not.toContain(code);
    } finally { restore(); }
  });
});

describe('consent and the encrypted data push', () => {
  const consentBody = (childId, over = {}) => ({
    notification: {
      status: 'GRANTED', consentId: over.consentId || 'c1',
      consentDetail: {
        hip: { id: HIP }, hiTypes: ['ImmunizationRecord'],
        careContexts: [{ patientReference: childId, careContextReference: 'immunization-record' }],
        permission: { dateRange: { from: '2024-01-01T00:00:00.000Z', to: '2025-01-01T00:00:00.000Z' }, dataEraseAt: '2099-01-01T00:00:00.000Z' },
      },
      signature: 'not-checked-here', grantAcknowledgement: false, ...over.notification,
    },
  });
  const remind = (as, childId, vaccineName, dueDate, reminderStatus) => as().post('/reminders').send({ childId, vaccineName, dueDate, reminderStatus }).expect(201);
  const hiRequest = (receiver, consentId = 'c1', over = {}) => ({
    transactionId: randomUUID(),
    hiRequest: { consent: { id: consentId }, dataPushUrl: 'https://hiu.example.org/data/push', dateRange: { from: '2024-01-01T00:00:00.000Z', to: '2025-01-01T00:00:00.000Z' }, keyMaterial: receiver.keyMaterial, ...over },
  });

  test('a granted consent leads to an acknowledgement, then an encrypted bundle the requester can decrypt, then a notification', async () => {
    const { as, id, post, settle, sent, calls, restore } = await setup();
    try {
      await remind(as, id, 'BCG', '2024-03-20', 'completed');
      await remind(as, id, 'MMR-1', '2024-12-15', 'scheduled'); // not given: never shared
      await remind(as, id, 'OPV-late', '2026-01-10', 'completed'); // outside the consent: never shared

      const rid = randomUUID();
      await post('/api/v3/consent/request/hip/notify', consentBody(id), { 'REQUEST-ID': rid }).expect(202);
      await settle();
      expect(sent('onConsentNotify')[0].body).toMatchObject({ acknowledgement: { status: 'OK', consentId: 'c1' }, response: { requestId: rid } });

      const receiver = createReceiver();
      const req = hiRequest(receiver);
      const hrid = randomUUID();
      await post('/api/v3/hip/health-information/request', req, { 'REQUEST-ID': hrid }).expect(202);
      await settle();

      expect(sent('onHealthInformationRequest')[0].body).toMatchObject({ hiRequest: { transactionId: req.transactionId, sessionStatus: 'ACKNOWLEDGED' }, response: { requestId: hrid } });
      const order = calls.map(([n]) => n);
      expect(order.indexOf('onHealthInformationRequest')).toBeLessThan(order.indexOf('push')); // acknowledge first, push after
      expect(order.indexOf('push')).toBeLessThan(order.indexOf('notifyDataFlow'));

      const [{ url, body }] = sent('push');
      expect(url).toBe('https://hiu.example.org/data/push');
      expect(body).toMatchObject({ pageNumber: 1, pageCount: 1, transactionId: req.transactionId });
      expect(body.keyMaterial).toMatchObject({ cryptoAlg: 'ECDH', curve: 'Curve25519' });
      const [entry] = body.entries;
      expect(entry).toMatchObject({ media: 'application/fhir+json', careContextReference: 'immunization-record' });
      expect(entry.content).not.toContain('BCG');

      const plain = receiver.decrypt(entry.content, body.keyMaterial);
      expect(createHash('md5').update(plain).digest('hex')).toBe(entry.checksum);
      expect(plain).toContain('BCG');
      expect(plain).not.toContain('MMR-1');
      expect(plain).not.toContain('OPV-late');
      expect(JSON.parse(plain).resourceType).toBe('Bundle');

      expect(sent('notifyDataFlow')[0].body.notification).toMatchObject({
        consentId: 'c1', transactionId: req.transactionId, notifier: { type: 'HIP', id: HIP },
        statusNotification: { sessionStatus: 'TRANSFERRED', hipId: HIP, statusResponses: [{ careContextReference: 'immunization-record', hiStatus: 'DELIVERED' }] },
      });
    } finally { restore(); }
  });

  test.each([
    ['no consent is known', null, () => 'unknown'],
    ['the consent was revoked', 'REVOKED', () => 'c1'],
  ])('refuses and pushes nothing when %s', async (_label, laterStatus, consentId) => {
    const { id, post, settle, sent, restore } = await setup();
    try {
      if (laterStatus) {
        await post('/api/v3/consent/request/hip/notify', consentBody(id)).expect(202);
        await post('/api/v3/consent/request/hip/notify', consentBody(id, { notification: { status: laterStatus } })).expect(202);
      }
      await post('/api/v3/hip/health-information/request', hiRequest(createReceiver(), consentId())).expect(202);
      await settle();
      expect(sent('onHealthInformationRequest')[0].body.error.code).toBe('ABDM-1062');
      expect(sent('push')).toHaveLength(0);
    } finally { restore(); }
  });

  test('an expired consent is refused, and a request outside the consented dates is refused', async () => {
    const { id, post, settle, sent, restore } = await setup();
    try {
      await post('/api/v3/consent/request/hip/notify', consentBody(id, { consentId: 'old', notification: { consentDetail: { ...consentBody(id).notification.consentDetail, permission: { dateRange: { from: '2024-01-01T00:00:00.000Z', to: '2025-01-01T00:00:00.000Z' }, dataEraseAt: '2020-01-01T00:00:00.000Z' } } } })).expect(202);
      await post('/api/v3/consent/request/hip/notify', consentBody(id, { consentId: 'c2' })).expect(202);
      await post('/api/v3/hip/health-information/request', hiRequest(createReceiver(), 'old')).expect(202);
      await post('/api/v3/hip/health-information/request', hiRequest(createReceiver(), 'c2', { dateRange: { from: '2030-01-01T00:00:00.000Z', to: '2031-01-01T00:00:00.000Z' } })).expect(202);
      await settle();
      const [expired, outside] = sent('onHealthInformationRequest');
      expect(expired.body.error.code).toBe('ABDM-1062');
      expect(outside.body.error.code).toBe('ABDM-1063');
      expect(sent('push')).toHaveLength(0);
    } finally { restore(); }
  });

  test.each(['http://hiu.example.org/p', 'https://127.0.0.1/p', 'https://localhost/p', 'https://user:pw@hiu.example.org/p', 'https://hiu.internal/p', 'https://hiu.example.org:8443/p'])('never posts records to %s', async (dataPushUrl) => {
    const { id, post, settle, sent, restore } = await setup();
    try {
      await post('/api/v3/consent/request/hip/notify', consentBody(id)).expect(202);
      await post('/api/v3/hip/health-information/request', hiRequest(createReceiver(), 'c1', { dataPushUrl })).expect(202);
      await settle();
      expect(sent('onHealthInformationRequest')[0].body.error).toBeDefined();
      expect(sent('push')).toHaveLength(0);
    } finally { restore(); }
  });

  test('nothing is pushed when the guardian has revoked their own consent to WombTo18 processing, and the failure is reported', async () => {
    const { as, id, repo, post, settle, sent, restore } = await setup();
    try {
      await remind(as, id, 'BCG', '2024-03-20', 'completed');
      repo.children.get(id).consentStatus = 'revoked'; // the guardian withdraws their consent after the ABDM consent was granted
      await post('/api/v3/consent/request/hip/notify', consentBody(id)).expect(202);
      await post('/api/v3/hip/health-information/request', hiRequest(createReceiver())).expect(202);
      await settle();
      expect(sent('push')).toHaveLength(0);
      expect(sent('notifyDataFlow')[0].body.notification.statusNotification.sessionStatus).toBe('FAILED');
    } finally { restore(); }
  });

  test('an unknown consent status or a notification for another facility is not acted on', async () => {
    const { id, post, settle, sent, restore } = await setup();
    try {
      await post('/api/v3/consent/request/hip/notify', consentBody(id, { notification: { status: 'MAYBE' } })).expect(202);
      const other = consentBody(id);
      other.notification.consentDetail.hip.id = 'IN1111111111';
      await post('/api/v3/consent/request/hip/notify', other).expect(202);
      await settle();
      expect(sent('onConsentNotify')).toHaveLength(0);
    } finally { restore(); }
  });
});

describe('the guard covers every inbound route', () => {
  test.each([
    '/api/v3/hip/patient/care-context/discover', '/api/v3/hip/link/care-context/init', '/api/v3/hip/link/care-context/confirm',
    '/api/v3/consent/request/hip/notify', '/api/v3/hip/health-information/request',
  ])('%s: no bearer token -> 401, wrong facility -> 403, nothing sent', async (path) => {
    const { app, settle, calls, restore } = await setup();
    try {
      await request(app).post(path).set({ 'X-HIP-ID': HIP, 'REQUEST-ID': randomUUID() }).send({}).expect(401);
      await request(app).post(path).set({ Authorization: 'Bearer t', 'X-HIP-ID': 'IN9999999999', 'REQUEST-ID': randomUUID() }).send({}).expect(403);
      await settle();
      expect(calls).toHaveLength(0);
    } finally { restore(); }
  });
});
