const { createApp } = require('../src/app');
const { createAbhaService } = require('../src/services/abhaService');
const { AppError } = require('../src/errors');
const { MemoryRepository } = require('../src/repositories/memoryRepository');
const { TEST_CONFIG, authedRequest, NEHA, ROHIT } = require('./helpers/auth');

// Create ABHA by Aadhaar OTP. The ABDM provider is a fake here: no network, no real Aadhaar.
// The Aadhaar value below is a made-up sentinel.
const AADHAAR = '555544443333';
const OTP = '246810';
const child = { name: 'Aarav Sharma', dateOfBirth: '2024-03-15', guardianName: 'Neha Sharma', state: 'Maharashtra', consentStatus: 'granted' };

const fakeProvider = () => ({
  mode: 'sandbox',
  requestAadhaarOtp: jest.fn(async ({ txnId }) => ({ txnId: txnId || 'txn-1', message: 'OTP sent to Aadhaar registered mobile number ending with ******0903', requestId: 'r1' })),
  enrolByAadhaar: jest.fn(async ({ otp }) => {
    if (otp !== OTP) throw new AppError(422, 'ABDM_REFUSED', 'UIDAI Error code : 400 : Invalid Aadhaar OTP value.', { abdmCode: 'ABDM-1204' });
    return {
      isNew: true,
      message: 'Account created successfully',
      txnId: 'txn-1',
      requestId: 'r2',
      tokens: { token: 'SECRET-X-TOKEN', refreshToken: 'SECRET-R-TOKEN' },
      ABHAProfile: { ABHANumber: '91-0000-0000-0000', phrAddress: ['test@sbx'], firstName: 'Test', photo: 'BASE64PHOTO', mobile: '******0903' },
    };
  }),
  suggestAddresses: jest.fn(async () => ({ abhaAddressList: ['test.one', 'test_two', 'test3'], requestId: 'r3' })),
  createAddress: jest.fn(async ({ abhaAddress }) => ({ healthIdNumber: '91-0000-0000-0000', preferredAbhaAddress: `${abhaAddress}@sbx`, requestId: 'r4' })),
  getProfile: jest.fn(async () => ({ ABHANumber: '91-0000-0000-0000', preferredAbhaAddress: 'test.one@sbx', dayOfBirth: '01', monthOfBirth: '02', yearOfBirth: '2000', mobile: '9999990001', firstName: 'Test', kycVerified: true, kycPhoto: 'BASE64PHOTO', requestId: 'r5' })),
  getCard: jest.fn(async () => ({ data: Buffer.from('PNGBYTES'), contentType: 'image/png', requestId: 'r6' })),
});

const setup = async (provider = fakeProvider()) => {
  const repo = new MemoryRepository();
  const app = createApp({ repo, logRequests: false, config: TEST_CONFIG, abhaProvider: provider });
  const as = (g = NEHA) => authedRequest(app, g);
  const id = (await as().post('/children').send(child).expect(201)).body.id;
  return { repo, as, id, provider };
};

describe('Create ABHA by Aadhaar OTP', () => {
  test('is refused unless ABDM_MODE=sandbox (the mock has no M1 creation)', async () => {
    const { as, id } = await setup({ mode: 'mock' });
    const res = await as().post(`/abha/children/${id}/create/request-otp`).send({ aadhaar: AADHAAR, consentAgreed: true }).expect(409);
    expect(res.body.error.code).toBe('SANDBOX_NOT_ENABLED');
  });

  test('a bad Aadhaar shows "Aadhaar Number is not valid" and sends nothing to ABDM (CRT_ABHA_104)', async () => {
    const { as, id, provider } = await setup();
    for (const aadhaar of ['12345678901', '1234567890123', 'abcdefghijkl', '1234-5678-90']) {
      const res = await as().post(`/abha/children/${id}/create/request-otp`).send({ aadhaar, consentAgreed: true }).expect(400);
      expect(res.body.error.details[0].message).toBe('Aadhaar Number is not valid');
      expect(JSON.stringify(res.body)).not.toContain(aadhaar);
    }
    expect(provider.requestAadhaarOtp).not.toHaveBeenCalled();
  });

  test('nothing is sent until the terms are agreed (CRT_ABHA_102)', async () => {
    const { as, id, provider } = await setup();
    await as().post(`/abha/children/${id}/create/request-otp`).send({ aadhaar: AADHAAR }).expect(400);
    await as().post(`/abha/children/${id}/create/request-otp`).send({ aadhaar: AADHAAR, consentAgreed: false }).expect(400);
    expect(provider.requestAadhaarOtp).not.toHaveBeenCalled();
  });

  test('only the owning guardian can use a child (others get 404)', async () => {
    const { as, id } = await setup();
    await as(ROHIT).post(`/abha/children/${id}/create/request-otp`).send({ aadhaar: AADHAAR, consentAgreed: true }).expect(404);
  });

  test('wrong OTP keeps the transaction; the right OTP then succeeds; tokens and photo never leave the server', async () => {
    const { as, id, provider } = await setup();
    const sent = await as().post(`/abha/children/${id}/create/request-otp`).send({ aadhaar: AADHAAR, consentAgreed: true }).expect(200);
    expect(sent.body.message).toContain('ending with');

    const wrong = await as().post(`/abha/children/${id}/create/verify-otp`).send({ txnId: sent.body.txnId, otp: '000000' }).expect(422);
    expect(wrong.body.error.message).toBe('UIDAI Error code : 400 : Invalid Aadhaar OTP value.');

    const ok = await as().post(`/abha/children/${id}/create/verify-otp`).send({ txnId: sent.body.txnId, otp: OTP }).expect(200);
    expect(ok.body.isNew).toBe(true);
    expect(ok.body.profile).toMatchObject({ abhaNumber: '91-0000-0000-0000', abhaAddresses: ['test@sbx'] });
    const text = JSON.stringify(ok.body);
    for (const secret of ['SECRET-X-TOKEN', 'SECRET-R-TOKEN', 'BASE64PHOTO']) expect(text).not.toContain(secret);
    expect(provider.enrolByAadhaar).toHaveBeenCalledTimes(2);
  });

  test('a transaction of another child or guardian is unknown', async () => {
    const { as, id } = await setup();
    const sent = await as().post(`/abha/children/${id}/create/request-otp`).send({ aadhaar: AADHAAR, consentAgreed: true }).expect(200);
    await as(ROHIT).post(`/abha/children/${id}/create/verify-otp`).send({ txnId: sent.body.txnId, otp: OTP }).expect(404);
    await as().post(`/abha/children/${id}/create/verify-otp`).send({ txnId: 'nope', otp: OTP }).expect(404);
  });

  test('the Aadhaar number and OTP are not in logs, responses, storage or audit', async () => {
    const logs = [];
    const spies = ['log', 'error', 'warn'].map((m) => jest.spyOn(console, m).mockImplementation((...a) => logs.push(a.join(' '))));
    try {
      const repo = new MemoryRepository();
      const app = createApp({ repo, logRequests: true, config: TEST_CONFIG, abhaProvider: fakeProvider() });
      const as = () => authedRequest(app, NEHA);
      const id = (await as().post('/children').send(child).expect(201)).body.id;
      const bodies = [];
      const sent = await as().post(`/abha/children/${id}/create/request-otp`).send({ aadhaar: AADHAAR, consentAgreed: true });
      bodies.push(JSON.stringify(sent.body));
      bodies.push(JSON.stringify((await as().post(`/abha/children/${id}/create/verify-otp`).send({ txnId: sent.body.txnId, otp: '111111' })).body));
      bodies.push(JSON.stringify((await as().post(`/abha/children/${id}/create/verify-otp`).send({ txnId: sent.body.txnId, otp: OTP })).body));
      bodies.push(JSON.stringify((await as().post(`/abha/children/${id}/create/request-otp`).send({ aadhaar: AADHAAR + '1', consentAgreed: true })).body));

      const audit = JSON.stringify(repo.auditEvents);
      expect(audit).toContain('ABHA_CREATE_OTP_REQUEST');
      const store = JSON.stringify([repo.children, repo.reminders, repo.abhaLinks, repo.consents].map((m) => [...m.values()]));
      expect(logs.length).toBeGreaterThan(0);
      for (const s of [AADHAAR, OTP, '111111']) {
        for (const where of [logs.join('\n'), bodies.join('\n'), audit, store]) expect(where).not.toContain(s);
      }
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});

describe('after the OTP: address, profile and card', () => {
  const verified = async () => {
    const ctx = await setup();
    const sent = await ctx.as().post(`/abha/children/${ctx.id}/create/request-otp`).send({ aadhaar: AADHAAR, consentAgreed: true }).expect(200);
    await ctx.as().post(`/abha/children/${ctx.id}/create/verify-otp`).send({ txnId: sent.body.txnId, otp: OTP }).expect(200);
    return { ...ctx, txnId: sent.body.txnId };
  };

  test('suggests addresses, creates one without the @ suffix, shows the profile and the card (CRT_ABHA_112 to 114)', async () => {
    const { as, id, txnId, provider } = await verified();
    const sug = await as().get(`/abha/children/${id}/create/address-suggestions?txnId=${txnId}`).expect(200);
    expect(sug.body.addresses.length).toBeGreaterThanOrEqual(3);

    const created = await as().post(`/abha/children/${id}/create/address`).send({ txnId, abhaAddress: 'test.one@sbx' }).expect(200);
    expect(provider.createAddress).toHaveBeenCalledWith({ txnId, abhaAddress: 'test.one' });
    expect(created.body).toMatchObject({ abhaNumber: '91-0000-0000-0000', abhaAddress: 'test.one@sbx' });

    const prof = await as().get(`/abha/children/${id}/create/profile?txnId=${txnId}`).expect(200);
    expect(prof.body.profile).toMatchObject({ abhaNumber: '91-0000-0000-0000', abhaAddress: 'test.one@sbx', dob: '01-02-2000', mobile: '******0001' });
    expect(JSON.stringify(prof.body)).not.toContain('9999990001');
    expect(JSON.stringify(prof.body)).not.toContain('BASE64PHOTO');

    const card = await as().get(`/abha/children/${id}/create/card?txnId=${txnId}`).expect(200);
    expect(card.headers['content-type']).toContain('image/png');
    expect(card.body.toString()).toBe('PNGBYTES');
    // the user token is passed to the provider but never sent back to the client
    expect(provider.getCard.mock.calls[0][0].xToken).toBe('SECRET-X-TOKEN');
  });

  test('refuses bad addresses before calling ABDM', async () => {
    const { as, id, txnId, provider } = await verified();
    for (const abhaAddress of ['1startsdigit', '.dot', 'ends.', 'two.dots.here', 'two_un_derscore', 'has space']) {
      await as().post(`/abha/children/${id}/create/address`).send({ txnId, abhaAddress }).expect(400);
    }
    expect(provider.createAddress).not.toHaveBeenCalled();
  });

  test('these steps need the OTP step first, and another guardian cannot use the transaction', async () => {
    const { as, id } = await setup();
    const sent = await as().post(`/abha/children/${id}/create/request-otp`).send({ aadhaar: AADHAAR, consentAgreed: true }).expect(200);
    const early = await as().get(`/abha/children/${id}/create/profile?txnId=${sent.body.txnId}`).expect(409);
    expect(early.body.error.code).toBe('ABHA_NOT_CREATED');
    await as(ROHIT).get(`/abha/children/${id}/create/card?txnId=${sent.body.txnId}`).expect(404);
  });
});

describe('OTP resend rules (CRT_ABHA_106)', () => {
  test('60 seconds between sends, at most 2 resends, same transaction', async () => {
    let clock = 1_000_000;
    const provider = fakeProvider();
    const repo = new MemoryRepository();
    const child1 = await repo.insertChild({ id: 'c1', guardianId: NEHA.id, ...child });
    const svc = createAbhaService({ repo, provider, now: () => new Date(clock) });

    const first = await svc.requestCreateOtp(child1.id, NEHA.id, { aadhaar: AADHAAR });
    await expect(svc.requestCreateOtp(child1.id, NEHA.id, { aadhaar: AADHAAR, txnId: first.txnId })).rejects.toMatchObject({ code: 'OTP_RESEND_TOO_SOON' });

    clock += 61_000;
    const second = await svc.requestCreateOtp(child1.id, NEHA.id, { aadhaar: AADHAAR, txnId: first.txnId });
    expect(second.txnId).toBe(first.txnId);
    clock += 61_000;
    await svc.requestCreateOtp(child1.id, NEHA.id, { aadhaar: AADHAAR, txnId: first.txnId });
    clock += 61_000;
    await expect(svc.requestCreateOtp(child1.id, NEHA.id, { aadhaar: AADHAAR, txnId: first.txnId })).rejects.toMatchObject({
      code: 'OTP_RESEND_LIMIT',
      message: 'Maximum OTP resend attempts reached. Please try again after 30 mins',
    });
    expect(provider.requestAadhaarOtp).toHaveBeenCalledTimes(3);
  });
});
