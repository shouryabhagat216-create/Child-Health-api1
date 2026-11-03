const crypto = require('crypto');
const f = require('../src/abdm/fidelius');

// Proves the maths and the round trip. It does NOT prove interop with a real Fidelius peer: that needs
// a peer (the sandbox) or its published test vectors.
const { P, A, A_OVER_3, montgomeryV } = f;
const mod = (a) => ((a % P) + P) % P;
const pow = (b, e) => { let r = 1n; let x = mod(b); for (let k = e; k > 0n; k >>= 1n) { if (k & 1n) r = (r * x) % P; x = (x * x) % P; } return r; };
const inv = (a) => pow(a, P - 2n);

describe('Curve25519 in short Weierstrass form', () => {
  const a = mod((3n - A * A) * inv(3n));
  const b = mod((2n * A ** 3n - 9n * A) * inv(27n));

  test('the Curve25519 base point (u = 9) lies on the curve built from the derived constants', () => {
    const x = mod(9n + A_OVER_3);
    const y = montgomeryV(9n);
    expect(mod(y * y)).toBe(mod(x ** 3n + a * x + b));
    expect(A).toBe(486662n); // the Montgomery coefficient of Curve25519
  });

  test('a converted public key lies on the Weierstrass curve', () => {
    const { rawU } = f.generateKeyPair();
    let u = 0n;
    for (let i = rawU.length - 1; i >= 0; i -= 1) u = (u << 8n) | BigInt(rawU[i]);
    const x = mod(u + A_OVER_3);
    const y = montgomeryV(u);
    expect(mod(y * y)).toBe(mod(x ** 3n + a * x + b));
  });
});

describe('the public key we send', () => {
  test('is an SPKI with the EC and Curve25519 OIDs and a 65-byte uncompressed point', () => {
    const { publicKeySpki } = f.generateKeyPair();
    expect(publicKeySpki[0]).toBe(0x30);
    expect(publicKeySpki.subarray(-65)[0]).toBe(0x04);
    expect(publicKeySpki.includes(Buffer.from('2a8648ce3d0201', 'hex'))).toBe(true);
    // 1.3.6.1.4.1.3029.1.5.1: the 3029 arc is 0x97 0x55 in base 128
    expect(publicKeySpki.includes(Buffer.from('2b060104019755010501', 'hex'))).toBe(true);
    expect(((0x97 & 0x7f) << 7) | 0x55).toBe(3029);
  });

  test('a peer key is read from its trailing 65 bytes, however it is wrapped', () => {
    const { publicKeySpki, rawU } = f.generateKeyPair();
    const wrapped = Buffer.concat([Buffer.from('3082013130820' + 'aa'.repeat(8), 'hex'), publicKeySpki.subarray(-65)]);
    expect(Buffer.compare(f.fromPeerKey(wrapped.toString('base64')), rawU)).toBe(0);
    expect(Buffer.compare(f.fromPeerKey(publicKeySpki.toString('base64')), rawU)).toBe(0);
  });

  test('refuses a key that is too short or not an uncompressed point', () => {
    expect(() => f.fromPeerKey(Buffer.alloc(10).toString('base64'))).toThrow();
    expect(() => f.fromPeerKey(Buffer.alloc(70, 2).toString('base64'))).toThrow();
  });
});

describe('record encryption', () => {
  test('both sides derive the same key: the HIU decrypts what the HIP encrypted', () => {
    const hiu = f.createReceiver();
    const hip = f.createSender(hiu.keyMaterial);
    const bundle = JSON.stringify({ resourceType: 'Bundle', note: 'synthetic' });
    const content = hip.encrypt(bundle);
    expect(content).not.toContain('Bundle');
    expect(hiu.decrypt(content, hip.keyMaterial)).toBe(bundle);
  });

  test('a fresh key pair and nonce for every transfer', () => {
    const hiu = f.createReceiver();
    const a = f.createSender(hiu.keyMaterial);
    const b = f.createSender(hiu.keyMaterial);
    expect(a.keyMaterial.nonce).not.toBe(b.keyMaterial.nonce);
    expect(a.keyMaterial.dhPublicKey.keyValue).not.toBe(b.keyMaterial.dhPublicKey.keyValue);
  });

  test('tampering is detected, and another receiver cannot decrypt', () => {
    const hiu = f.createReceiver();
    const hip = f.createSender(hiu.keyMaterial);
    const content = Buffer.from(hip.encrypt('secret'), 'base64');
    content[0] ^= 1;
    expect(() => hiu.decrypt(content.toString('base64'), hip.keyMaterial)).toThrow();
    const other = f.createReceiver();
    expect(() => other.decrypt(hip.encrypt('secret'), hip.keyMaterial)).toThrow();
  });

  test('the nonce is split into a 20-byte salt and a 12-byte IV, and must be 32 bytes', () => {
    const a = crypto.randomBytes(32);
    const b = crypto.randomBytes(32);
    const secret = crypto.randomBytes(32);
    const { key, iv } = f.deriveKeyAndIv(secret, a, b);
    expect(key.length).toBe(32);
    expect(iv.length).toBe(12);
    const xor = Buffer.from(a.map((v, i) => v ^ b[i]));
    expect(Buffer.compare(iv, xor.subarray(20))).toBe(0);
    expect(() => f.deriveKeyAndIv(secret, crypto.randomBytes(16), b)).toThrow();
  });

  test('refuses incomplete key material', () => {
    expect(() => f.createSender({})).toThrow();
    expect(() => f.createSender({ dhPublicKey: { keyValue: 'x' } })).toThrow();
  });
});
