// Checks every callback ABDM posts to our bridge BEFORE any handler reads the body
// (hiecm.concept.callback-authenticity): a bearer token is present, and X-HIP-ID / X-HIU-ID names one of
// our own facilities. Fails closed and logs each rejection (path and reason only, never the body).
// How to verify the bearer token's signature is not published; that is to be confirmed at onboarding,
// so no signature check is invented here.
function createCallbackGuard({ facilityIds, log = (line) => console.warn(line) }) {
  return function callbackGuard(req, res, next) {
    const reject = (status, reason) => {
      log(JSON.stringify({ level: 'warn', event: 'callback_rejected', reason, path: req.path, requestId: req.get('REQUEST-ID') || null }));
      return res.status(status).json({ error: { code: 'CALLBACK_REJECTED', message: 'Callback rejected' } });
    };
    if (!/^Bearer\s+\S+/.test(req.get('Authorization') || '')) return reject(401, 'missing bearer token');
    const facility = req.get('X-HIP-ID') || req.get('X-HIU-ID');
    if (!facility || !facilityIds().has(facility)) return reject(403, 'facility header does not name one of our facilities');
    req.facilityId = facility;
    return next();
  };
}

module.exports = { createCallbackGuard };
