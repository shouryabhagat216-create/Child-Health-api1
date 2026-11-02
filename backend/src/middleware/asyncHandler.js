// Express 4 does not catch rejected promises from async handlers, so wrap them.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
