const { createApp } = require('../src/app');
const { AppError } = require('../src/errors');
const { MemoryRepository } = require('../src/repositories/memoryRepository');
const { TEST_CONFIG, authedRequest, NEHA, ROHIT } = require('./helpers/auth');

// Login with an ABHA number (VRFY_ABHA_101 Aadhaar OTP, VRFY_ABHA_201 ABHA-mobile OTP). The ABDM
// provider is a fake: no network, made-up ABHA number and OTP.
const ABHA = '91-1111-2222-3333';
const OTP = '135790';
const child = { name: 'Aarav Sharma', dateOfBirth: '2024-03-15', guardianName: 'Neha Sharma', state: 'Maharashtra', consentStatus: 'granted' };

const fakeProvider = (overrides = {}) => ({
  mode: 'sandbox',
  requestLoginOtp: jest.fn(async () => ({ txnId: 'login-1', message: 'OTP sent to mobile ending ******6648', requestId: 'l1' })),
  verifyLoginOtp: jest.fn(async ({ otp }) => {
    if (otp !== OTP) throw new AppError(400, 'ABDM_REFUSED', 'Invalid OTP value', { abdmCode: 'otpValue' });
    return {
      authResult: 'success',
      message: 'OTP verified successfully',
      token: 'LOGIN-X-TOKEN',
      refreshToken: 'LOGIN-R-TOKEN',
      requestId: 'l2',
      accounts: [{ ABHANumber: ABHA, preferredAbhaAddress: 'x@sbx', name: 'Test Person', status: 'ACTIVE', profilePhoto: 'BASE64PHOTO' }],
    };
  }),
  getProfile: jest.fn(async () => ({ ABHANumber: ABHA, preferredAbhaAddress: 'x@sbx', firstName: 'Test', requestId: 'l3' })),
  getCard: jest.fn(async () => ({ data: Buffer.from('PNG'), contentType: 'image/png', requestId: 'l4' })),
  ...overrides,
});

const setup = async (provider = fakeProvider()) => {
  const repo = new MemoryRepository();
  const app = createApp({ repo, logRequests: false, config: TEST_CONFIG, abhaProvider: provider });
  const as = (g = NEHA) => authedRequest(app, g);
  const id = (await as().post('/children').send(child).expect(201)).body.id;
  return { repo, as, id, provider };
};
const url = (id, p) => `/abha/children/${id}/login/${p}`;

describe('Login with an ABHA number', () => {
  test.each(['aadhaar', 'mobile'])('by %s OTP: request, verify, then the profile with the same user token', async (method) => {
    const { as, id, provider } = await setup();
    const sent = await as().post(url(id, 'request-otp')).send({ abhaNumber: ABHA, method }).expect(200);
    expect(provider.requestLoginOtp).toHaveBeenCalledWith({ abhaNumber: ABHA, method });

    const ok = await as().post(url(id, 'verify-otp')).send({ txnId: sent.body.txnId, otp: OTP }).expect(200);
    expect(ok.body).toMatchObject({ authResult: 'success', accounts: [{ abhaNumber: ABHA, abhaAddress: 'x@sbx', name: 'Test Person' }] });
    const text = JSON.stringify(ok.body);
    for (const secret of ['LOGIN-X-TOKEN', 'LOGIN-R-TOKEN', 'BASE64PHOTO']) expect(text).not.toContain(secret);
    expect(provider.verifyLoginOtp).toHaveBeenCalledWith(expect.objectContaining({ method }));

    await as().get(`${url(id, 'profile')}?txnId=${sent.body.txnId}`).expect(200);
    expect(provider.getProfile.mock.calls[0][0].xToken).toBe('LOGIN-X-TOKEN');
    await as().get(`${url(id, 'card')}?txnId=${sent.body.txnId}`).expect(200);
  });

  test('the ABHA number may be typed with or without dashes or spaces', async () => {
    const { as, id, provider } = await setup();
    for (const typed of ['91-1111-2222-3333', '91111122223333', '91 1111 2222 3333']) {
      await as().post(url(id, 'request-otp')).send({ abhaNumber: typed, method: 'aadhaar' }).expect(200);
    }
    for (const call of provider.requestLoginOtp.mock.calls) expect(call[0].abhaNumber).toBe(ABHA);
  });

  test('a bad ABHA number or method sends nothing to ABDM', async () => {
    const { as, id, provider } = await setup();
    for (const body of [{ abhaNumber: '123', method: 'aadhaar' }, { abhaNumber: 'abcdefghijklmn', method: 'mobile' }, { abhaNumber: ABHA, method: 'face' }, { abhaNumber: ABHA }]) {
      await as().post(url(id, 'request-otp')).send(body).expect(400);
    }
    expect(provider.requestLoginOtp).not.toHaveBeenCalled();
  });

  test('a wrong OTP keeps the transaction; the right one then works', async () => {
    const { as, id } = await setup();
    const sent = await as().post(url(id, 'request-otp')).send({ abhaNumber: ABHA, method: 'aadhaar' }).expect(200);
    const bad = await as().post(url(id, 'verify-otp')).send({ txnId: sent.body.txnId, otp: '000000' }).expect(400);
    expect(bad.body.error.message).toBe('Invalid OTP value');
    await as().post(url(id, 'verify-otp')).send({ txnId: sent.body.txnId, otp: OTP }).expect(200);
  });

  test('ABDM-1114 (nobody holds this ABHA) is passed on as ABDM sent it', async () => {
    const provider = fakeProvider({
      requestLoginOtp: jest.fn(async () => {
        throw new AppError(404, 'ABDM_REFUSED', 'User not found.', { abdmCode: 'ABDM-1114' });
      }),
    });
    const { as, id } = await setup(provider);
    const res = await as().post(url(id, 'request-otp')).send({ abhaNumber: ABHA, method: 'aadhaar' }).expect(404);
    expect(res.body.error.details.abdmCode).toBe('ABDM-1114');
  });

  test('refuses a login response without a user token instead of guessing', async () => {
    const provider = fakeProvider({ verifyLoginOtp: jest.fn(async () => ({ authResult: 'success', token: 'only-a-short-token', requestId: 'x' })) });
    const { as, id } = await setup(provider);
    const sent = await as().post(url(id, 'request-otp')).send({ abhaNumber: ABHA, method: 'mobile' }).expect(200);
    const res = await as().post(url(id, 'verify-otp')).send({ txnId: sent.body.txnId, otp: OTP }).expect(502);
    expect(res.body.error.code).toBe('ABDM_UNEXPECTED_LOGIN_RESPONSE');
    expect(JSON.stringify(res.body)).not.toContain('only-a-short-token');
  });

  test('a create transaction cannot be used to log in, and other guardians get 404', async () => {
    const { as, id } = await setup();
    const sent = await as().post(url(id, 'request-otp')).send({ abhaNumber: ABHA, method: 'aadhaar' }).expect(200);
    await as(ROHIT).post(url(id, 'request-otp')).send({ abhaNumber: ABHA, method: 'aadhaar' }).expect(404);
    await as(ROHIT).post(url(id, 'verify-otp')).send({ txnId: sent.body.txnId, otp: OTP }).expect(404);
    await as().post(`/abha/children/${id}/create/verify-otp`).send({ txnId: sent.body.txnId, otp: OTP }).expect(404);
  });

  test('the OTP and the ABHA number are not in the audit trail or the stored data', async () => {
    const { as, id, repo } = await setup();
    const sent = await as().post(url(id, 'request-otp')).send({ abhaNumber: ABHA, method: 'aadhaar' });
    await as().post(url(id, 'verify-otp')).send({ txnId: sent.body.txnId, otp: OTP });
    const where = JSON.stringify([repo.auditEvents, [...repo.children.values()], [...repo.abhaLinks.values()]]);
    expect(where).toContain('ABHA_LOGIN_OTP_VERIFY');
    expect(where).not.toContain(OTP);
    expect(where).not.toContain(ABHA);
  });
});
