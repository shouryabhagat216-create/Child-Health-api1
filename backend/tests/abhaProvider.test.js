const { generateKeyPairSync, privateDecrypt, constants } = require('crypto');
const { createEncryptor, OAEP_SHA1 } = require('../src/abdm/abha/encryption');
const { createAbhaProvider } = require('../src/abdm/abha');

// A throwaway key made for these tests. It is not an ABDM key.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const certBody = (extra = {}) => ({
  publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  encryptionAlgorithm: OAEP_SHA1,
  ...extra,
});
const decrypt = (b64) =>
  privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(b64, 'base64')).toString('utf8');

describe('ABHA encryption', () => {
  it('encrypts with OAEP/SHA-1 so the private key can decrypt it', async () => {
    const enc = createEncryptor({ fetchCertificate: async () => certBody() });
    const out = await enc.encrypt('123456');
    expect(out).not.toContain('123456');
    expect(decrypt(out)).toBe('123456');
  });

  it('refuses a certificate that names an unknown algorithm', async () => {
    const enc = createEncryptor({ fetchCertificate: async () => certBody({ encryptionAlgorithm: 'RSA/ECB/PKCS1Padding' }) });
    await expect(enc.encrypt('x')).rejects.toMatchObject({ code: 'ABDM_ENCRYPTION_UNSUPPORTED' });
  });

  it('refuses a certificate with no key', async () => {
    const enc = createEncryptor({ fetchCertificate: async () => ({ encryptionAlgorithm: OAEP_SHA1 }) });
    await expect(enc.encrypt('x')).rejects.toMatchObject({ code: 'ABDM_CERTIFICATE_INVALID' });
  });

  it('caches the certificate until it expires, then fetches again', async () => {
    let clock = 0;
    const fetchCertificate = jest.fn(async () => certBody());
    const enc = createEncryptor({ fetchCertificate, now: () => clock, ttlMs: 1000 });
    await enc.encrypt('a');
    await enc.encrypt('b');
    expect(fetchCertificate).toHaveBeenCalledTimes(1);
    clock = 1001;
    await enc.encrypt('c');
    expect(fetchCertificate).toHaveBeenCalledTimes(2);
  });
});

describe('ABHA provider switch', () => {
  const sandboxClient = { getToken: async () => 'fake-token' };

  it('gives the mock provider unless ABDM_MODE is sandbox', () => {
    expect(createAbhaProvider({ config: { mode: 'mock' } }).mode).toBe('mock');
  });

  it('refuses a production or unknown ABHA host', () => {
    for (const abhaBaseUrl of ['https://abha.abdm.gov.in', 'https://evil.example.com', 'not a url']) {
      expect(() => createAbhaProvider({ config: { mode: 'sandbox', abhaBaseUrl }, sandboxClient })).toThrow();
    }
  });

  it('fetches the certificate from the sandbox ABHA host with the gateway token', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => certBody() }));
    const provider = createAbhaProvider({
      config: { mode: 'sandbox', abhaBaseUrl: 'https://abhasbx.abdm.gov.in' },
      sandboxClient,
      fetchImpl,
    });
    expect(provider.mode).toBe('sandbox');
    expect(decrypt(await provider.encrypt('654321'))).toBe('654321');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://abhasbx.abdm.gov.in/abha/api/v3/profile/public/certificate');
    expect(init.headers.Authorization).toBe('Bearer fake-token');
    expect(init.headers['REQUEST-ID']).toBeTruthy();
  });

  it('reports a refused certificate without leaking the token', async () => {
    const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ code: '900908' }) });
    const provider = createAbhaProvider({
      config: { mode: 'sandbox', abhaBaseUrl: 'https://abhasbx.abdm.gov.in' },
      sandboxClient,
      fetchImpl,
    });
    const err = await provider.encrypt('1').catch((e) => e);
    expect(err.code).toBe('ABDM_CERTIFICATE_REJECTED');
    expect(JSON.stringify(err)).not.toContain('fake-token');
  });
});
