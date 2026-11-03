const { createApp } = require('../src/app');
const { MemoryRepository } = require('../src/repositories/memoryRepository');
const { syntheticAbhaFor } = require('../src/abdm/syntheticAbha');
const { TEST_CONFIG, authedRequest, NEHA } = require('./helpers/auth');

// Aadhaar numbers and OTPs must never be stored or logged. These sentinels are NOT real: they are
// sent as wrong OTPs and in rejected fields, then searched for in everything the app could leak
// into: console output (access log and error log), response bodies, the repository and the audit
// trail. When the real M1 flows exist, add their requests to the `sendSentinels` list below.
const SENTINEL_OTP = '918273';
const SENTINEL_AADHAAR = '999988887777';

const child = { name: 'Aarav Sharma', dateOfBirth: '2024-03-15', guardianName: 'Neha Sharma', state: 'Maharashtra', consentStatus: 'granted' };

describe('sensitive values never reach logs, responses, storage or the audit trail', () => {
  let logs;
  const spies = [];

  beforeEach(() => {
    logs = [];
    for (const m of ['log', 'error', 'warn', 'info']) {
      spies.push(jest.spyOn(console, m).mockImplementation((...args) => logs.push(args.map(String).join(' '))));
    }
  });
  afterEach(() => spies.splice(0).forEach((s) => s.mockRestore()));

  test('wrong OTPs and Aadhaar-shaped input are not echoed or kept anywhere', async () => {
    const repo = new MemoryRepository();
    // logRequests: true so the real access log is captured too.
    const app = createApp({ repo, logRequests: true, config: TEST_CONFIG });
    const as = () => authedRequest(app, NEHA);
    const bodies = [];
    const keep = (res) => bodies.push(JSON.stringify({ status: res.status, headers: res.headers, body: res.body }));

    const created = await as().post('/children').send(child).expect(201);
    const childId = created.body.id;

    const sendSentinels = async () => {
      // 1. wrong OTP on ABHA verification
      keep(await as().post(`/abdm/children/${childId}/abha/verify`).send({ abhaNumber: syntheticAbhaFor(childId), otp: SENTINEL_OTP }));
      // 2. an Aadhaar number in a field the schema does not allow (strict -> 400)
      keep(await as().post(`/abdm/children/${childId}/abha/verify`).send({ abhaNumber: syntheticAbhaFor(childId), otp: '123456', aadhaar: SENTINEL_AADHAAR }));
      // 3. an Aadhaar number where an ABHA number is expected
      keep(await as().post(`/abdm/children/${childId}/abha/verify`).send({ abhaNumber: SENTINEL_AADHAAR, otp: SENTINEL_OTP }));
      // 4. wrong OTP while linking a care context
      await as().post(`/abdm/children/${childId}/abha/verify`).send({ abhaNumber: syntheticAbhaFor(childId), otp: '123456' }).expect(200);
      const init = await as().post(`/abdm/children/${childId}/care-contexts/link-init`).expect(200);
      keep(await as().post(`/abdm/children/${childId}/care-contexts/link-confirm`).send({ transactionId: init.body.transactionId, otp: SENTINEL_OTP }));
      // 5. sentinel inside a query string
      keep(await as().get(`/abdm/children/${childId}/abha?aadhaar=${SENTINEL_AADHAAR}&otp=${SENTINEL_OTP}`));
    };
    await sendSentinels();

    const audit = JSON.stringify(await repo.listAuditEvents(childId, NEHA.id));
    const store = JSON.stringify({
      children: [...repo.children.values()],
      reminders: [...repo.reminders.values()],
      abhaLinks: [...repo.abhaLinks.values()],
      careContexts: [...repo.careContexts.values()],
      consents: [...repo.consents.values()],
      auditEvents: repo.auditEvents,
    });

    // The checks above are only meaningful if the app really ran and logged.
    expect(logs.length).toBeGreaterThan(0);
    expect(audit).toContain('ABHA_VERIFY');

    for (const sentinel of [SENTINEL_OTP, SENTINEL_AADHAAR]) {
      expect(logs.join('\n')).not.toContain(sentinel);
      expect(bodies.join('\n')).not.toContain(sentinel);
      expect(audit).not.toContain(sentinel);
      expect(store).not.toContain(sentinel);
    }
  });
});
