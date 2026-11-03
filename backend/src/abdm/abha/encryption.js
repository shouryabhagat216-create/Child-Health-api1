const { publicEncrypt, constants, createPublicKey } = require('crypto');
const { AppError } = require('../../errors');

// Encrypts the sensitive M1 inputs (Aadhaar, ABHA number, mobile, email, OTP, password) with the
// ABHA public certificate, in this process only. The plaintext is never logged or sent anywhere
// except inside the ciphertext.
//
// The certificate response names its algorithm. We read that field and refuse a value we do not
// recognise, instead of falling back to a default. The certificate is cached with an expiry so a
// key rotation recovers by itself.
const OAEP_SHA1 = 'RSA/ECB/OAEPWithSHA-1AndMGF1Padding';

function toPem(base64Der) {
  const body = base64Der.replace(/\s+/g, '');
  if (body.includes('BEGIN')) return base64Der;
  return `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----\n`;
}

function createEncryptor({ fetchCertificate, now = () => Date.now(), ttlMs = 60 * 60 * 1000 }) {
  let cached = null; // { key, algorithm, expiresAt }

  async function certificate() {
    if (cached && cached.expiresAt > now()) return cached;
    const cert = await fetchCertificate();
    if (!cert || typeof cert.publicKey !== 'string' || !cert.publicKey) {
      throw new AppError(502, 'ABDM_CERTIFICATE_INVALID', 'The ABHA certificate response had no public key');
    }
    if (cert.encryptionAlgorithm !== OAEP_SHA1) {
      throw new AppError(502, 'ABDM_ENCRYPTION_UNSUPPORTED', 'The ABHA certificate names an encryption algorithm this client does not support');
    }
    cached = { key: createPublicKey(toPem(cert.publicKey)), algorithm: cert.encryptionAlgorithm, expiresAt: now() + ttlMs };
    return cached;
  }

  return {
    // Returns standard base64 of the ciphertext.
    async encrypt(plaintext) {
      const { key } = await certificate();
      return publicEncrypt(
        { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
        Buffer.from(String(plaintext), 'utf8')
      ).toString('base64');
    },
    // Forces a fresh certificate next time (for example after the sandbox refuses every encrypted value).
    invalidate() {
      cached = null;
    },
  };
}

module.exports = { createEncryptor, OAEP_SHA1, toPem };
