const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { randomUUID } = require('crypto');

const defaults = require('./config');
const { createTokenService } = require('./auth/tokens');
const authenticate = require('./middleware/authenticate');
const { createLimiter } = require('./middleware/rateLimit');
const { authRouter } = require('./routes/auth');
const requestId = require('./middleware/requestId');
const requestLogger = require('./middleware/requestLogger');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { createChildService } = require('./services/childService');
const { createReminderService } = require('./services/reminderService');
const { healthRouter } = require('./routes/health');
const { childrenRouter } = require('./routes/children');
const { remindersRouter } = require('./routes/reminders');

// App factory: dependencies are injected so tests can use an in-memory repository
// and a fixed id generator (needed to test the duplicate-id check).
// `config` can be overridden in tests (e.g. a tiny rate limit).
function createApp({ repo, generateId = randomUUID, logRequests = true, config = defaults }) {
  const app = express();

  app.use(requestId);
  app.use(helmet());
  // Browsers may only call the API from the configured frontend origin.
  // Requests without an Origin header (curl, server-to-server) are still served; CORS only restricts browsers.
  app.use(cors({ origin: (origin, cb) => cb(null, origin === config.corsOrigin) }));
  app.use(express.json({ limit: '100kb' }));
  if (logRequests) app.use(requestLogger);

  const tokens = createTokenService({ secret: config.jwtSecret, expiresIn: config.jwtExpiresIn });
  const requireAuth = authenticate({ tokens });
  const generalLimiter = createLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.max });
  // Much stricter on login to slow down password guessing.
  const loginLimiter = createLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.loginMax });

  const childService = createChildService({ repo, generateId });
  const reminderService = createReminderService({ repo });

  // Public: /health (for load balancer checks) and the mock login. Everything else needs a token.
  app.use('/health', healthRouter({ repo }));
  app.use('/auth', authRouter({ tokens, loginLimiter }));
  app.use('/children', generalLimiter, requireAuth, childrenRouter({ childService }));
  app.use('/reminders', generalLimiter, requireAuth, remindersRouter({ reminderService }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
