const { createApp } = require('../src/app');
const { MemoryRepository } = require('../src/repositories/memoryRepository');
const { toImmunizationBundle } = require('../src/fhir/mapper');
const { syntheticAbhaFor } = require('../src/abdm/syntheticAbha');
const { TEST_CONFIG, authedRequest, NEHA, ROHIT } = require('./helpers/auth');

// All data below is synthetic. FHIR output is core-R4-shaped only: no ABDM profile validation.
const validChild = {
  name: 'Aarav Sharma',
  dateOfBirth: '2024-03-15',
  guardianName: 'Neha Sharma',
  state: 'Maharashtra',
  consentStatus: 'granted',
};
const OTP = '123456';

const setup = () => {
  const repo = new MemoryRepository();
  const app = createApp({ repo, logRequests: false, config: TEST_CONFIG });
  return { repo, app, as: (g = NEHA) => authedRequest(app, g) };
};

// Child + completed/scheduled reminders + verified ABHA + linked care context.
async function readyChild({ childOverrides = {}, link = true } = {}) {
  const ctx = setup();
  const { as } = ctx;
  const child = (await as().post('/children').send({ ...validChild, ...childOverrides }).expect(201)).body;
  const remind = (vaccineName, dueDate, reminderStatus) =>
    as().post('/reminders').send({ childId: child.id, vaccineName, dueDate, reminderStatus }).expect(201);
  await remind('BCG', '2024-03-20', 'completed'); // in range, completed -> shared
  await remind('MMR-1', '2024-12-15', 'scheduled'); // not given yet -> never shared
  await remind('OPV-booster', '2026-01-10', 'completed'); // outside the consented range -> not shared
  await as().post(`/abdm/children/${child.id}/abha/verify`).send({ abhaNumber: syntheticAbhaFor(child.id), otp: OTP }).expect(200);
  if (link) {
    const init = await as().post(`/abdm/children/${child.id}/care-contexts/link-init`).expect(200);
    await as()
      .post(`/abdm/children/${child.id}/care-contexts/link-confirm`)
      .send({ transactionId: init.body.transactionId, otp: OTP })
      .expect(201);
  }
  return { ...ctx, child };
}

const newConsent = async (as, childId) =>
  (
    await as()
      .post(`/abdm/children/${childId}/consents`)
      .send({ purpose: 'CAREMGT', hiTypes: ['ImmunizationRecord'], dateFrom: '2024-01-01', dateTo: '2025-01-01' })
      .expect(201)
  ).body.consent.id;

const fetchInfo = (as, consentId, headers = {}) =>
  as().post(`/abdm/consents/${consentId}/health-information`).set(headers);

describe('health-information fetch is gated by consent', () => {
  test('refused until the guardian approves (403 CONSENT_NOT_GRANTED)', async () => {
    const { as, child } = await readyChild();
    const id = await newConsent(as, child.id);
    const res = await fetchInfo(as, id).expect(403);
    expect(res.body.error.code).toBe('CONSENT_NOT_GRANTED');
  });

  test('returns a FHIR Bundle with only completed, in-range immunizations', async () => {
    const { as, child } = await readyChild();
    const id = await newConsent(as, child.id);
    await as().post(`/abdm/consents/${id}/approve`).expect(200);
    const res = await fetchInfo(as, id).expect(200);

    expect(res.body).toMatchObject({ mock: true, encrypted: false, recordCount: 1 });
    const { bundle } = res.body;
    expect(bundle).toMatchObject({ resourceType: 'Bundle', type: 'document' });
    expect(bundle.entry[0].resource.resourceType).toBe('Composition'); // required first entry of a document
    const types = bundle.entry.map((e) => e.resource.resourceType);
    expect(types.filter((t) => t === 'Immunization')).toHaveLength(1);
    const imm = bundle.entry.find((e) => e.resource.resourceType === 'Immunization').resource;
    expect(imm).toMatchObject({ status: 'completed', vaccineCode: { text: 'BCG' }, occurrenceDateTime: '2024-03-20' });

    // Data minimisation: no guardian name, no full ABHA number, no scheduled/out-of-range vaccines.
    const text = JSON.stringify(bundle);
    expect(text).not.toContain('Neha');
    expect(text).not.toContain(syntheticAbhaFor(child.id));
    expect(text).not.toContain('MMR-1');
    expect(text).not.toContain('OPV-booster');
  });

  test('every reference inside the bundle points at an entry in the bundle', async () => {
    const { as, child } = await readyChild();
    const id = await newConsent(as, child.id);
    await as().post(`/abdm/consents/${id}/approve`).expect(200);
    const { bundle } = (await fetchInfo(as, id).expect(200)).body;
    const urls = new Set(bundle.entry.map((e) => e.fullUrl));
    const refs = JSON.stringify(bundle).match(/"reference":"([^"]+)"/g).map((r) => r.slice(13, -1));
    expect(refs.length).toBeGreaterThan(0);
    refs.forEach((r) => expect(urls.has(r)).toBe(true));
  });

  test('revocation blocks the very next fetch', async () => {
    const { as, child } = await readyChild();
    const id = await newConsent(as, child.id);
    await as().post(`/abdm/consents/${id}/approve`).expect(200);
    await fetchInfo(as, id).expect(200);
    await as().post(`/abdm/consents/${id}/revoke`).expect(200);
    const res = await fetchInfo(as, id).expect(403);
    expect(res.body.error.code).toBe('CONSENT_NOT_GRANTED');
  });

  test("sharing also needs the guardian's own consent to be 'granted'", async () => {
    const { as, child } = await readyChild({ childOverrides: { consentStatus: 'pending' } });
    const id = await newConsent(as, child.id);
    await as().post(`/abdm/consents/${id}/approve`).expect(200);
    const res = await fetchInfo(as, id).expect(403);
    expect(res.body.error.code).toBe('CONSENT_REVOKED');
  });

  test('needs a linked care context (409)', async () => {
    const { as, child } = await readyChild({ link: false });
    const id = await newConsent(as, child.id);
    await as().post(`/abdm/consents/${id}/approve`).expect(200);
    const res = await fetchInfo(as, id).expect(409);
    expect(res.body.error.code).toBe('CARE_CONTEXT_NOT_LINKED');
  });

  test('another guardian gets 404 and no data', async () => {
    const { as, child } = await readyChild();
    const id = await newConsent(as, child.id);
    await as().post(`/abdm/consents/${id}/approve`).expect(200);
    const res = await fetchInfo(() => as(ROHIT), id).expect(404);
    expect(res.body.bundle).toBeUndefined();
  });
});

describe('audit events', () => {
  test('a full flow is audited, in order, with outcomes', async () => {
    const { as, child } = await readyChild();
    const id = await newConsent(as, child.id);
    await fetchInfo(as, id).expect(403); // before approval
    await as().post(`/abdm/consents/${id}/approve`).expect(200);
    await fetchInfo(as, id).expect(200);
    await as().post(`/abdm/consents/${id}/revoke`).expect(200);
    await fetchInfo(as, id).expect(403);

    const { events } = (await as().get(`/abdm/children/${child.id}/audit`).expect(200)).body;
    expect(events.map((e) => [e.eventType, e.outcome])).toEqual([
      ['ABHA_VERIFY', 'SUCCESS'],
      ['CARE_CONTEXT_LINK_INIT', 'SUCCESS'],
      ['CARE_CONTEXT_LINK_CONFIRM', 'SUCCESS'],
      ['CONSENT_REQUEST', 'SUCCESS'],
      ['HEALTH_INFORMATION_FETCH', 'DENIED'],
      ['CONSENT_APPROVE', 'SUCCESS'],
      ['HEALTH_INFORMATION_FETCH', 'SUCCESS'],
      ['CONSENT_REVOKE', 'SUCCESS'],
      ['HEALTH_INFORMATION_FETCH', 'DENIED'],
    ]);
    expect(events[4]).toMatchObject({ reasonCode: 'CONSENT_NOT_GRANTED', consentId: id, childId: child.id });
    events.forEach((e) => expect(e.requestId).toMatch(/^[0-9a-f-]{36}$/));
  });

  test('audit events never contain ABHA numbers, OTPs, tokens, names or health data', async () => {
    const { as, repo, child } = await readyChild();
    const id = await newConsent(as, child.id);
    await as().post(`/abdm/consents/${id}/approve`).expect(200);
    await fetchInfo(as, id).expect(200);
    const dump = JSON.stringify(repo.auditEvents);
    expect(dump).not.toContain(syntheticAbhaFor(child.id));
    expect(dump).not.toContain(OTP);
    expect(dump).not.toContain('Bearer');
    expect(dump).not.toContain('Aarav');
    expect(dump).not.toContain('BCG');
    expect(dump).not.toContain('Immunization"'); // no resource content
  });

  test("a failed attempt on someone else's child is recorded for ops but invisible to the owner", async () => {
    const { as, repo, child } = await readyChild();
    const id = await newConsent(as, child.id);
    await fetchInfo(() => as(ROHIT), id).expect(404);
    const attempt = repo.auditEvents.find((e) => e.actorGuardianId === ROHIT.id);
    expect(attempt).toMatchObject({ eventType: 'HEALTH_INFORMATION_FETCH', outcome: 'FAILURE', reasonCode: 'CONSENT_NOT_FOUND' });
    const { events } = (await as().get(`/abdm/children/${child.id}/audit`).expect(200)).body;
    expect(events.some((e) => e.actorGuardianId === ROHIT.id)).toBe(false);
    await as(ROHIT).get(`/abdm/children/${child.id}/audit`).expect(404);
  });

  test('gateway failures are audited as FAILURE with the error code', async () => {
    const { as, child } = await readyChild();
    const id = await newConsent(as, child.id);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await fetchInfo(as, id, { 'X-Mock-Scenario': 'timeout' }).expect(504);
    console.error.mockRestore();
    const { events } = (await as().get(`/abdm/children/${child.id}/audit`).expect(200)).body;
    expect(events[events.length - 1]).toMatchObject({ outcome: 'FAILURE', reasonCode: 'GATEWAY_TIMEOUT' });
  });
});

describe('FHIR mapper', () => {
  test('an empty immunization list still gives a well-formed document bundle', () => {
    const bundle = toImmunizationBundle({
      child: { id: 'c1', name: 'Test Child', dateOfBirth: '2024-01-01', state: 'Kerala' },
      abhaNumberMasked: '**-****-****-1234',
      immunizations: [],
    });
    expect(bundle.entry.map((e) => e.resource.resourceType)).toEqual(['Composition', 'Patient', 'Organization']);
    expect(bundle.entry[0].resource.section[0].entry).toEqual([]);
    expect(JSON.stringify(bundle)).not.toContain('"profile"'); // no ABDM profile claim
  });
});
