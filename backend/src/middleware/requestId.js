const { randomUUID } = require('crypto');

// Attach a request id to every request so logs and error responses can be correlated.
// An incoming X-Request-Id is accepted only if it looks safe.
const SAFE_ID = /^[\w-]{1,64}$/;

module.exports = function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.set('X-Request-Id', req.id);
  next();
};
