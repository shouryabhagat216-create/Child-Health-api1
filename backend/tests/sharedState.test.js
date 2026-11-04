const request = require('supertest');
const { createApp } = require('../src/app');
const { MemoryRepository } = require('../src/repositories/memoryRepository');
const { createMemoryStore } = require('../src/state/stateStore');
const { TEST_CONFIG, authedRequest, NEHA } = require('./helpers/auth');

// Two app instances (two containers) sharing one state store: a call sent by one is answered at the other.
const HIP = 'IN0000000099';
const ABHA = 'test.person@sbx';
const child = { name: 'Aarav Sharma', dateOfBirth: '2024-03-15', guardianName: 'Neha Sharma', state: 'Maharashtra', consentStatus: 'granted' };

test('a callback landing on a different container than the request is still matched, once', async () => {
  const repo = new MemoryRepository();
  const store = createMemoryStore();
  const sent = [];
  const hipClient = { generateLinkToken: jest.fn(async (a) => { sent.push(a); return { accepted: true }; }), linkCareContext: jest.fn() };
  const mk = () => createApp({ repo, store, logRequests: false, config: TEST_CONFIG, bridge: { facilities: () => [{ serviceId: HIP, type: 'HIP' }], hipClient } });
  const one = mk();
  const two = mk();
  const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const id = (await authedRequest(one, NEHA).post('/children').send(child).expect(201)).body.id;
    await authedRequest(one, NEHA).post(`/hip/children/${id}/link-token`).send({ abhaAddress: ABHA, gender: 'M' }).expect(202);
    const cb = (app) => request(app).post('/api/v3/hip/token/on-generate-token').set({ Authorization: 'Bearer t', 'X-HIP-ID': HIP })
      .send({ abhaAddress: ABHA, linkToken: 'TOKEN', response: { requestId: sent[0].requestId } });
    await cb(two).expect(202);
    // status is visible from either container
    expect((await authedRequest(one, NEHA).get(`/hip/children/${id}/link-status`).expect(200)).body.tokenStatus).toBe('RECEIVED');
    expect((await authedRequest(two, NEHA).get(`/hip/children/${id}/link-status`).expect(200)).body.tokenStatus).toBe('RECEIVED');
    // the same callback again, to the other container, is dropped (not an answer to anything pending)
    await cb(one).expect(202);
    expect(spy.mock.calls.some(([l]) => String(l).includes('not an answer to a call we sent'))).toBe(true);
  } finally { spy.mockRestore(); }
});
