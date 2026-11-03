const crypto = require('crypto');
const { AppError } = require('../errors');

// ECDH + AES-GCM record encryption for ABDM health-information transfer ("Fidelius" scheme), written
// from the ABDM docs (shared.concept.fidelius-ecdh-interop). NOT yet proven against a real Fidelius peer:
// the tests below prove the maths and the round trip only. See INTEGRATION-PLAN.md.
//
//  - curve: Curve25519 in its short Weierstrass form inside an X.509 key, as BouncyCastle does
//  - public key we send: SPKI (EC public key + Curve25519 OIDs), bit string = 04 || x || y
//  - a peer's key: take its trailing 65 bytes as the point (it may carry named or explicit parameters)
//  - nonce: each side sends 32 random bytes; XOR them: first 20 bytes = HKDF salt, last 12 bytes = GCM IV
//  - key = HKDF-SHA256(shared secret x, salt, 32 bytes), empty info; AES-256-GCM, no AAD, tag appended
//  - fresh key pair and nonce for every transfer
const P = 2n ** 255n - 19n;
const A = 486662n;
const mod = (a) => ((a % P) + P) % P;
const pow = (b, e) => {
  let r = 1n;
  let x = mod(b);
  for (let k = e; k > 0n; k >>= 1n) {
    if (k & 1n) r = (r * x) % P;
    x = (x * x) % P;
  }
  return r;
};
const inv = (a) => pow(a, P - 2n);
const A_OVER_3 = mod(A * inv(3n));

const fromBytesBE = (buf) => BigInt(`0x${Buffer.from(buf).toString('hex') || '0'}`);
const toBytesBE = (n) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
const fromBytesLE = (buf) => fromBytesBE(Buffer.from(buf).reverse());
const toBytesLE = (n) => toBytesBE(n).reverse();

// y of the point with Montgomery coordinate u (B = 1): y^2 = u^3 + A u^2 + u. p = 5 mod 8.
function montgomeryV(u) {
  const rhs = mod(u * u * u + A * u * u + u);
  let y = pow(rhs, (P + 3n) / 8n);
  if (mod(y * y) !== rhs) y = mod(y * pow(2n, (P - 1n) / 4n));
  if (mod(y * y) !== rhs) throw new AppError(400, 'INVALID_PUBLIC_KEY', 'The public key is not a point on Curve25519');
  return y;
}

const OID_EC_PUBLIC_KEY = Buffer.from('06072a8648ce3d0201', 'hex'); // 1.2.840.10045.2.1
const OID_CURVE25519 = Buffer.from('060a2b060104019755010501', 'hex'); // 1.3.6.1.4.1.3029.1.5.1
const der = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  const len = body.length < 128 ? Buffer.from([body.length]) : Buffer.from([0x81, body.length]);
  return Buffer.concat([Buffer.from([tag]), len, body]);
};

// X25519 raw public key (u, little endian) -> SPKI with the Weierstrass point.
function toSpki(rawU) {
  const u = fromBytesLE(rawU);
  const point = Buffer.concat([Buffer.from([0x04]), toBytesBE(mod(u + A_OVER_3)), toBytesBE(montgomeryV(u))]);
  return der(0x30, der(0x30, OID_EC_PUBLIC_KEY, OID_CURVE25519), der(0x03, Buffer.concat([Buffer.from([0x00]), point])));
}

// A peer's SPKI (base64) -> X25519 raw u, from its trailing 65 bytes.
function fromPeerKey(base64Key) {
  const bytes = Buffer.from(base64Key, 'base64');
  if (bytes.length < 65) throw new AppError(400, 'INVALID_PUBLIC_KEY', 'The public key is too short');
  const point = bytes.subarray(bytes.length - 65);
  if (point[0] !== 0x04) throw new AppError(400, 'INVALID_PUBLIC_KEY', 'The public key is not an uncompressed point');
  const xw = fromBytesBE(point.subarray(1, 33));
  return toBytesLE(mod(xw - A_OVER_3));
}

const x25519Public = (rawU) =>
  crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: Buffer.from(rawU).toString('base64url') }, format: 'jwk' });

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const rawU = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  return { privateKey, publicKeySpki: toSpki(rawU), rawU };
}

// The x coordinate (Weierstrass form) of the shared point, 32 bytes big endian.
function sharedSecretX(privateKey, peerRawU) {
  const out = crypto.diffieHellman({ privateKey, publicKey: x25519Public(peerRawU) }); // Montgomery u, LE
  return toBytesBE(mod(fromBytesLE(out) + A_OVER_3));
}

function deriveKeyAndIv(secretX, nonceA, nonceB) {
  if (nonceA.length !== 32 || nonceB.length !== 32) throw new AppError(400, 'INVALID_NONCE', 'Each nonce must be 32 bytes');
  const xor = Buffer.alloc(32);
  for (let i = 0; i < 32; i += 1) xor[i] = nonceA[i] ^ nonceB[i];
  const key = Buffer.from(crypto.hkdfSync('sha256', secretX, xor.subarray(0, 20), Buffer.alloc(0), 32));
  return { key, iv: xor.subarray(20, 32) };
}

// Encrypts one string for a requester. `requester` is the keyMaterial of the health-information request.
// Returns what goes into the push: our keyMaterial and a function-free result per entry.
function createSender(requester) {
  if (!requester || !requester.dhPublicKey || !requester.dhPublicKey.keyValue || !requester.nonce) {
    throw new AppError(400, 'INVALID_KEY_MATERIAL', 'The requester key material is incomplete');
  }
  const peerNonce = Buffer.from(requester.nonce, 'base64');
  const ours = generateKeyPair();
  const ourNonce = crypto.randomBytes(32);
  const { key, iv } = deriveKeyAndIv(sharedSecretX(ours.privateKey, fromPeerKey(requester.dhPublicKey.keyValue)), ourNonce, peerNonce);
  return {
    keyMaterial: {
      cryptoAlg: 'ECDH',
      curve: 'Curve25519',
      dhPublicKey: {
        expiry: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        parameters: 'Curve25519/32byte random key',
        keyValue: ours.publicKeySpki.toString('base64'),
      },
      nonce: ourNonce.toString('base64'),
    },
    encrypt(plaintext) {
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
      return body.toString('base64');
    },
  };
}

// The receiving side (used by M3, and by the tests): decrypt with our private key and the sender's material.
function createReceiver() {
  const ours = generateKeyPair();
  const ourNonce = crypto.randomBytes(32);
  return {
    keyMaterial: {
      cryptoAlg: 'ECDH',
      curve: 'Curve25519',
      dhPublicKey: {
        expiry: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        parameters: 'Ephemeral public key',
        keyValue: ours.publicKeySpki.toString('base64'),
      },
      nonce: ourNonce.toString('base64'),
    },
    decrypt(content, senderKeyMaterial) {
      const secret = sharedSecretX(ours.privateKey, fromPeerKey(senderKeyMaterial.dhPublicKey.keyValue));
      const { key, iv } = deriveKeyAndIv(secret, Buffer.from(senderKeyMaterial.nonce, 'base64'), ourNonce);
      const raw = Buffer.from(content, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(raw.subarray(raw.length - 16));
      return Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]).toString('utf8');
    },
  };
}

module.exports = { createSender, createReceiver, generateKeyPair, toSpki, fromPeerKey, sharedSecretX, deriveKeyAndIv, P, A, A_OVER_3, montgomeryV };
