const crypto = require('crypto');

// Shared state for things that must survive a restart and be seen by every container: ABDM transactions, pending
// callbacks, consents, received records. One small interface, two implementations:
//   memory   - for tests and DB_MODE=memory; values are JSON round-tripped so a value that could not be stored in
//              the database fails here too.
//   postgres - table app_state (migration 005); every value is encrypted (AES-256-GCM) before it is written, with
//              the namespace and key as authenticated data so a row cannot be moved to another key.
// Values must be plain JSON (no Map, Set, Buffer or functions). Aadhaar numbers and OTPs are never put here.
//
// get/put/del/take/list all take a namespace first. ttlMs makes a row expire; expired rows are never returned.

const IV_BYTES = 12;

function createMemoryStore({ now = () => Date.now() } = {}) {
  const spaces = new Map(); // namespace -> Map(key -> { json, expiresAt })
  const space = (ns) => {
    if (!spaces.has(ns)) spaces.set(ns, new Map());
    return spaces.get(ns);
  };
  const live = (entry) => entry && (entry.expiresAt === null || entry.expiresAt > now());

  return {
    kind: 'memory',
    async get(ns, key) {
      const entry = space(ns).get(key);
      return live(entry) ? JSON.parse(entry.json) : null;
    },
    async put(ns, key, value, { ttlMs } = {}) {
      space(ns).set(key, { json: JSON.stringify(value), expiresAt: ttlMs ? now() + ttlMs : null });
    },
    // Writes only if the key is free (or expired). Returns true when this call wrote it.
    async putNew(ns, key, value, { ttlMs } = {}) {
      if (live(space(ns).get(key))) return false;
      space(ns).set(key, { json: JSON.stringify(value), expiresAt: ttlMs ? now() + ttlMs : null });
      return true;
    },
    async del(ns, key) {
      space(ns).delete(key);
    },
    // Atomic read-and-remove: of two concurrent callers only one gets the value.
    async take(ns, key) {
      const entry = space(ns).get(key);
      space(ns).delete(key);
      return live(entry) ? JSON.parse(entry.json) : null;
    },
    async list(ns) {
      return [...space(ns).entries()].filter(([, e]) => live(e)).map(([key, e]) => ({ key, value: JSON.parse(e.json) }));
    },
    async purgeExpired() {
      let n = 0;
      for (const m of spaces.values()) for (const [k, e] of m) if (!live(e)) { m.delete(k); n += 1; }
      return n;
    },
    async close() {},
  };
}

function parseKey(encoded) {
  const key = Buffer.from(String(encoded || ''), 'base64');
  if (key.length !== 32) throw new Error('STATE_ENCRYPTION_KEY must be 32 bytes, base64 encoded (for example: openssl rand -base64 32)');
  return key;
}

function createPostgresStore({ pool, encryptionKey }) {
  const key32 = parseKey(encryptionKey);
  const aad = (ns, key) => Buffer.from(`${ns}\u0000${key}`);

  const seal = (ns, key, value) => {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key32, iv);
    cipher.setAAD(aad(ns, key));
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  };
  const open = (ns, key, blob) => {
    const iv = blob.subarray(0, IV_BYTES);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key32, iv);
    decipher.setAAD(aad(ns, key));
    decipher.setAuthTag(blob.subarray(IV_BYTES, IV_BYTES + 16));
    return JSON.parse(Buffer.concat([decipher.update(blob.subarray(IV_BYTES + 16)), decipher.final()]).toString('utf8'));
  };
  const expiry = (ttlMs) => (ttlMs ? new Date(Date.now() + ttlMs) : null);

  return {
    kind: 'postgres',
    async get(ns, key) {
      const { rows } = await pool.query('SELECT value FROM app_state WHERE namespace = $1 AND key = $2 AND (expires_at IS NULL OR expires_at > now())', [ns, key]);
      return rows.length ? open(ns, key, rows[0].value) : null;
    },
    async put(ns, key, value, { ttlMs } = {}) {
      await pool.query(
        `INSERT INTO app_state (namespace, key, value, expires_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (namespace, key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at, updated_at = now()`,
        [ns, key, seal(ns, key, value), expiry(ttlMs)]
      );
    },
    async putNew(ns, key, value, { ttlMs } = {}) {
      const { rowCount } = await pool.query(
        `INSERT INTO app_state (namespace, key, value, expires_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (namespace, key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at, updated_at = now()
         WHERE app_state.expires_at IS NOT NULL AND app_state.expires_at <= now()`,
        [ns, key, seal(ns, key, value), expiry(ttlMs)]
      );
      return rowCount === 1;
    },
    async del(ns, key) {
      await pool.query('DELETE FROM app_state WHERE namespace = $1 AND key = $2', [ns, key]);
    },
    async take(ns, key) {
      const { rows } = await pool.query('DELETE FROM app_state WHERE namespace = $1 AND key = $2 RETURNING value, (expires_at IS NULL OR expires_at > now()) AS live', [ns, key]);
      return rows.length && rows[0].live ? open(ns, key, rows[0].value) : null;
    },
    async list(ns) {
      const { rows } = await pool.query('SELECT key, value FROM app_state WHERE namespace = $1 AND (expires_at IS NULL OR expires_at > now())', [ns]);
      return rows.map((r) => ({ key: r.key, value: open(ns, r.key, r.value) }));
    },
    async purgeExpired() {
      const { rowCount } = await pool.query('DELETE FROM app_state WHERE expires_at IS NOT NULL AND expires_at <= now()');
      return rowCount;
    },
    async close() {},
  };
}

function createStateStore({ config, repo }) {
  if (config.dbMode === 'memory' || !repo || !repo.pool) return createMemoryStore();
  return createPostgresStore({ pool: repo.pool, encryptionKey: config.stateEncryptionKey });
}

module.exports = { createMemoryStore, createPostgresStore, createStateStore };
