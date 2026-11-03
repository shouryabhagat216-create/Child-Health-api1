const jwt = require('jsonwebtoken');

// The algorithm is pinned to HS256 on both sign and verify, so a token cannot
// pick a weaker algorithm (e.g. "none") for itself.
const ALGORITHM = 'HS256';

function createTokenService({ secret, expiresIn = '1h' }) {
  return {
    sign(guardianId) {
      return jwt.sign({ sub: guardianId }, secret, { algorithm: ALGORITHM, expiresIn });
    },
    // Returns the guardian id, or null if the token is missing, tampered with or expired.
    verify(token) {
      try {
        const payload = jwt.verify(token, secret, { algorithms: [ALGORITHM] });
        return typeof payload.sub === 'string' ? payload.sub : null;
      } catch {
        return null;
      }
    },
  };
}

module.exports = { createTokenService };
