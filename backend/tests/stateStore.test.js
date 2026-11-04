const { createMemoryStore, createPostgresStore } = require('../src/state/stateStore');
const { createReceiver, createSender } = require('../src/abdm/fidelius');

const KEY = Buffer.alloc(32, 9).toString('base64');

// The same behaviour is required of both stores. The Postgres run needs TEST_DATABASE_URL (a scratch database
// with migrations applied) and is skipped without it.
function contract(name, make) {
  describe(name, () => {
    let store;
    let clock;
    beforeEach(async () => { clock = { t: 1_000_000 }; store = await make(clock); });

    test('put, get, del', async () => {
      await store.put('ns', 'a', { x: 1 });
      expect(await store.get('ns', 'a')).toEqual({ x: 1 });
      expect(await store.get('other', 'a')).toBeNull();
      await store.del('ns', 'a');
      expect(await store.get('ns', 'a')).toBeNull();
    });

    test('take returns the value once', async () => {
      await store.put('ns', 'a', { x: 1 });
      const [one, two] = await Promise.all([store.take('ns', 'a'), store.take('ns', 'a')]);
      expect([one, two].filter(Boolean)).toHaveLength(1);
    });

    test('putNew writes only once', async () => {
      expect(await store.putNew('ns', 'a', { n: 1 })).toBe(true);
      expect(await store.putNew('ns', 'a', { n: 2 })).toBe(false);
      expect(await store.get('ns', 'a')).toEqual({ n: 1 });
    });

    test('list returns the namespace only', async () => {
      await store.put('ns', 'a', 1);
      await store.put('ns', 'b', 2);
      await store.put('other', 'c', 3);
      expect((await store.list('ns')).map((e) => e.key).sort()).toEqual(['a', 'b']);
    });
  });
}

contract('memory store', async (clock) => createMemoryStore({ now: () => clock.t }));

describe('memory store expiry', () => {
  test('expired rows are not returned and putNew may reuse the key', async () => {
    let t = 1000;
    const store = createMemoryStore({ now: () => t });
    await store.put('ns', 'a', { v: 1 }, { ttlMs: 100 });
    t += 101;
    expect(await store.get('ns', 'a')).toBeNull();
    expect(await store.putNew('ns', 'a', { v: 2 }, { ttlMs: 100 })).toBe(true);
    expect(await store.purgeExpired()).toBe(0);
  });
  test('a value that is not plain JSON data does not survive (so it would also fail in the database)', async () => {
    const store = createMemoryStore();
    await store.put('ns', 'a', { m: new Map([[1, 2]]), s: new Set([1]) });
    expect(await store.get('ns', 'a')).toEqual({ m: {}, s: {} });
  });
});

describe('postgres store', () => {
  const url = process.env.TEST_DATABASE_URL;
  const run = url ? describe : describe.skip;
  run('against a real database', () => {
    const { Pool } = require('pg');
    let pool;
    let store;
    beforeAll(async () => {
      pool = new Pool({ connectionString: url });
      store = createPostgresStore({ pool, encryptionKey: KEY });
    });
    beforeEach(async () => { await pool.query('DELETE FROM app_state'); });
    afterAll(async () => { await pool.end(); });

    test('round trip, take, putNew, list, expiry', async () => {
      await store.put('ns', 'a', { x: 1 });
      expect(await store.get('ns', 'a')).toEqual({ x: 1 });
      expect(await store.putNew('ns', 'a', { x: 2 })).toBe(false);
      expect(await store.putNew('ns', 'b', { x: 3 })).toBe(true);
      expect((await store.list('ns')).map((e) => e.key).sort()).toEqual(['a', 'b']);
      const [one, two] = await Promise.all([store.take('ns', 'a'), store.take('ns', 'a')]);
      expect([one, two].filter(Boolean)).toHaveLength(1);
      await store.put('ns', 'c', { y: 1 }, { ttlMs: 50 });
      await new Promise((r) => setTimeout(r, 80));
      expect(await store.get('ns', 'c')).toBeNull();
      expect(await store.putNew('ns', 'c', { y: 2 }, { ttlMs: 1000 })).toBe(true);
      await store.put('ns', 'd', { y: 1 }, { ttlMs: 20 });
      await new Promise((r) => setTimeout(r, 50));
      expect(await store.purgeExpired()).toBe(1);
    });

    test('the stored bytes are encrypted, and a row moved to another key is refused', async () => {
      await store.put('ns', 'secret', { token: 'SENTINEL-TOKEN' });
      const { rows } = await pool.query("SELECT value FROM app_state WHERE key = 'secret'");
      expect(rows[0].value.toString('utf8')).not.toContain('SENTINEL-TOKEN');
      await pool.query("UPDATE app_state SET key = 'moved' WHERE key = 'secret'");
      await expect(store.get('ns', 'moved')).rejects.toThrow();
      const wrongKey = createPostgresStore({ pool, encryptionKey: Buffer.alloc(32, 1).toString('base64') });
      await store.put('ns', 'k', { a: 1 });
      await expect(wrongKey.get('ns', 'k')).rejects.toThrow();
    });
  });

  test('a key that is not 32 bytes is refused', () => {
    expect(() => createPostgresStore({ pool: {}, encryptionKey: 'short' })).toThrow(/32 bytes/);
  });
});

describe('Fidelius receiver survives the store', () => {
  test('a restored receiver decrypts what a sender encrypted for the original', async () => {
    const store = createMemoryStore();
    const original = createReceiver();
    await store.put('hiu-push', 't', { receiver: original.serialize() });
    const restored = createReceiver((await store.get('hiu-push', 't')).receiver);
    const sender = createSender({ ...original.keyMaterial });
    const content = sender.encrypt('hello records');
    expect(restored.decrypt(content, sender.keyMaterial)).toBe('hello records');
  });
});
