const { createMemoryStore } = require('../../state/stateStore');

// Remembers the REQUEST-ID of every call we sent that ABDM answers later by callback. A callback is only
// acted on when its response.requestId is one of these, and only once: take() removes it (atomically in the
// shared store), so a callback delivered twice, or to two containers at once, is acted on once.
const NS = 'pending-request';

function createPendingRequests({ store = createMemoryStore(), now = () => Date.now(), ttlMs = 24 * 60 * 60 * 1000 } = {}) {
  return {
    async add(requestId, meta) {
      await store.put(NS, requestId, { ...meta, expiresAt: now() + ttlMs }, { ttlMs });
    },
    async take(requestId) {
      const entry = await store.take(NS, requestId);
      return entry && entry.expiresAt > now() ? entry : null;
    },
  };
}

module.exports = { createPendingRequests };
