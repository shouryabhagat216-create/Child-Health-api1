const { UnauthorizedError } = require('../errors');
const { findById } = require('../auth/mockGuardians');

// Requires "Authorization: Bearer <token>". On success sets req.guardian = { id }.
// Every ownership check downstream uses req.guardian.id, never an id sent by the client.
function authenticate({ tokens }) {
  return (req, res, next) => {
    const [scheme, token] = (req.get('authorization') || '').split(' ');
    const guardianId = scheme === 'Bearer' && token ? tokens.verify(token) : null;
    // Same message for every failure so the response does not hint at why it failed.
    if (!guardianId || !findById(guardianId)) {
      return next(new UnauthorizedError('A valid Bearer token is required'));
    }
    req.guardian = { id: guardianId };
    return next();
  };
}

module.exports = authenticate;
