// Remembers the REQUEST-ID of every call we sent that ABDM answers later by callback. A callback is only
// acted on when its response.requestId is one of these, and only once: take() removes it, so a callback
// delivered twice is dropped the second time. Held in memory (lost on restart); move to the database
// before running more than one container.
function createPendingRequests({ now = () => Date.now(), ttlMs = 24 * 60 * 60 * 1000 } = {}) {
  const entries = new Map();
  return {
    add(requestId, meta) {
      entries.set(requestId, { ...meta, expiresAt: now() + ttlMs });
    },
    take(requestId) {
      const entry = entries.get(requestId);
      if (!entry) return null;
      entries.delete(requestId);
      return entry.expiresAt > now() ? entry : null;
    },
    size: () => entries.size,
  };
}

module.exports = { createPendingRequests };
