const rateLimit = require('express-rate-limit');
const { AppError } = require('../errors');

// Limits are per client IP and kept in memory (fine for one container).
// With several containers you would need a shared store such as Redis.
// Behind a load balancer, set app.set('trust proxy', ...) so the real client IP is used.
function createLimiter({ windowMs, max }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    // Use our standard error shape instead of the library's plain-text reply.
    handler: (req, res, next) =>
      next(new AppError(429, 'RATE_LIMITED', 'Too many requests, please try again later')),
  });
}

module.exports = { createLimiter };
