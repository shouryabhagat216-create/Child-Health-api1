const { randomUUID } = require('crypto');
const { AppError } = require('../../errors');
const { createEncryptor } = require('./encryption');

// The switch between the mock and the real ABHA (M1) sandbox. Only the sandbox ABHA host is allowed,
// so production can never be called by accident. At this step the sandbox provider can fetch the
// certificate and encrypt; the M1 journeys are added on top of it step by step (see INTEGRATION-PLAN.md).
const ALLOWED_ABHA_HOSTS = ['abhasbx.abdm.gov.in'];

function assertAbhaHost(baseUrl) {
  let host;
  try {
    host = new URL(baseUrl).host;
  } catch {
    throw new Error('ABDM_ABHA_BASE_URL is not a valid URL');
  }
  if (!ALLOWED_ABHA_HOSTS.includes(host)) {
    throw new Error(`ABDM_ABHA_BASE_URL host '${host}' is not an allowed sandbox host`);
  }
}

function createMockAbhaProvider() {
  return { mode: 'mock' };
}

function createSandboxAbhaProvider({ config, sandboxClient, fetchImpl = globalThis.fetch, now = () => new Date(), newId = randomUUID }) {
  assertAbhaHost(config.abhaBaseUrl);
  if (!sandboxClient) throw new Error('The sandbox ABHA provider needs the sandbox gateway client');
  const base = config.abhaBaseUrl.replace(/\/$/, '');

  async function getCertificate() {
    const token = await sandboxClient.getToken();
    const requestId = newId();
    const res = await fetchImpl(`${base}/abha/api/v3/profile/public/certificate`, {
      headers: { Authorization: `Bearer ${token}`, 'REQUEST-ID': requestId, TIMESTAMP: now().toISOString() },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new AppError(502, 'ABDM_CERTIFICATE_REJECTED', 'The ABHA service refused the certificate request', {
        sandboxStatus: res.status,
        requestId,
      });
    }
    return body;
  }

  const encryptor = createEncryptor({ fetchCertificate: getCertificate });

  // One call to the ABHA service. Returns the body on success; on a refusal throws an error that
  // carries ABDM's own code and message as returned. Request bodies (which hold encrypted values) and
  // the tokens in a response are never part of an error. `binary` returns the raw bytes (the card image).
  async function call(method, path, { body, headers: extraHeaders = {}, binary = false } = {}) {
    const token = await sandboxClient.getToken();
    const requestId = newId();
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'REQUEST-ID': requestId,
        TIMESTAMP: now().toISOString(),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.ok && binary) {
      return { data: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type'), requestId };
    }
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      /* body was not JSON */
    }
    if (!res.ok) {
      const err = data && typeof data.error === 'object' && data.error ? data.error : data;
      const field = Object.entries(data || {}).find(([k, v]) => k !== 'timestamp' && typeof v === 'string');
      throw new AppError(res.status >= 500 ? 502 : res.status, 'ABDM_REFUSED', err.message || (field && field[1]) || 'ABDM refused the request', {
        abdmStatus: res.status,
        abdmCode: err.code || (field && field[0]),
        requestId,
      });
    }
    return { data, requestId };
  }
  const post = (path, body, headers) => call('POST', path, { body, headers });
  const userHeaders = (xToken) => ({ 'X-token': `Bearer ${xToken}` });

  return {
    mode: 'sandbox',
    getCertificate,
    encrypt: encryptor.encrypt,
    invalidateCertificate: encryptor.invalidate,

    // Step 1 of "Create ABHA, Aadhaar OTP". A txnId resends to the same transaction.
    async requestAadhaarOtp({ aadhaar, txnId }) {
      const { data, requestId } = await post('/abha/api/v3/enrollment/request/otp', {
        ...(txnId ? { txnId } : {}),
        scope: ['abha-enrol'],
        loginHint: 'aadhaar',
        loginId: await encryptor.encrypt(aadhaar),
        otpSystem: 'aadhaar',
      });
      return { txnId: data.txnId, message: data.message, requestId };
    },

    // Step 2: verify the OTP. Consent code and version are fixed by the specification.
    async enrolByAadhaar({ txnId, otp, mobile }) {
      const { data, requestId } = await post('/abha/api/v3/enrollment/enrol/byAadhaar', {
        authData: { authMethods: ['otp'], otp: { txnId, otpValue: await encryptor.encrypt(otp), ...(mobile ? { mobile } : {}) } },
        consent: { code: 'abha-enrollment', version: '1.4' },
      });
      return { ...data, requestId };
    },

    // Login with an ABHA number (VRFY_ABHA_101 by Aadhaar OTP, VRFY_ABHA_201 by the ABHA-linked mobile OTP).
    // The ABHA number keeps its dashes and is encrypted like every other identifier.
    async requestLoginOtp({ abhaNumber, method }) {
      const aadhaar = method === 'aadhaar';
      const { data, requestId } = await post('/abha/api/v3/profile/login/request/otp', {
        scope: ['abha-login', aadhaar ? 'aadhaar-verify' : 'mobile-verify'],
        loginHint: 'abha-number',
        loginId: await encryptor.encrypt(abhaNumber),
        otpSystem: aadhaar ? 'aadhaar' : 'abdm',
      });
      return { txnId: data.txnId, message: data.message, requestId };
    },
    async verifyLoginOtp({ txnId, otp, method }) {
      const { data, requestId } = await post('/abha/api/v3/profile/login/verify', {
        scope: ['abha-login', method === 'aadhaar' ? 'aadhaar-verify' : 'mobile-verify'],
        authData: { authMethods: ['otp'], otp: { txnId, otpValue: await encryptor.encrypt(otp) } },
      });
      return { ...data, requestId };
    },

    // Steps 7 and 8: suggested ABHA addresses for the transaction, and creating the chosen one
    // (sent without the @ suffix).
    async suggestAddresses({ txnId }) {
      const { data, requestId } = await call('GET', '/abha/api/v3/enrollment/enrol/suggestion', { headers: { TRANSACTION_ID: txnId } });
      return { abhaAddressList: data.abhaAddressList || [], requestId };
    },
    async createAddress({ txnId, abhaAddress }) {
      const { data, requestId } = await post('/abha/api/v3/enrollment/enrol/abha-address', { txnId, abhaAddress, preferred: 1 });
      return { ...data, requestId };
    },

    // The profile and the card need the user token (X-token) from the creation response.
    async getProfile({ xToken }) {
      const { data, requestId } = await call('GET', '/abha/api/v3/profile/account', { headers: userHeaders(xToken) });
      return { ...data, requestId };
    },
    async getCard({ xToken }) {
      return call('GET', '/abha/api/v3/profile/account/abha-card', { headers: userHeaders(xToken), binary: true });
    },
  };
}

function createAbhaProvider({ config, sandboxClient, fetchImpl, now, newId }) {
  return config.mode === 'sandbox'
    ? createSandboxAbhaProvider({ config, sandboxClient, fetchImpl, now, newId })
    : createMockAbhaProvider();
}

module.exports = { createAbhaProvider, createMockAbhaProvider, createSandboxAbhaProvider, ALLOWED_ABHA_HOSTS };
