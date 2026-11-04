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
const { createAbdmService } = require('./services/abdmService');
const { createMockGateway } = require('./abdm/mockGateway');
const { createAuditService } = require('./services/auditService');
const { abdmRouter } = require('./routes/abdm');
const { sandboxRouter } = require('./routes/sandbox');
const { createSandboxClient } = require('./abdm/sandboxClient');
const { createAbhaProvider } = require('./abdm/abha');
const { createAbhaService } = require('./services/abhaService');
const { abhaRouter } = require('./routes/abha');
const { loadFacilities, idsOf } = require('./abdm/facilities');
const { createPendingRequests } = require('./abdm/bridge/pendingRequests');
const { createCallbackGuard } = require('./middleware/callbackGuard');
const { createHipClient } = require('./abdm/hip/hipClient');
const { createHipLinkingService } = require('./services/hipLinkingService');
const { bridgeRouter } = require('./routes/bridge');
const { createHipDataService } = require('./services/hipDataService');
const { safePushUrl } = require('./abdm/safePushUrl');
const { hipRouter } = require('./routes/hip');
const { createHiuService } = require('./services/hiuService');
const { hiuRouter } = require('./routes/hiu');
const { createStateStore } = require('./state/stateStore');

// App factory: dependencies are injected so tests can use an in-memory repository
// and a fixed id generator (needed to test the duplicate-id check).
// `config` can be overridden in tests (e.g. a tiny rate limit).
function createApp({ repo, store: injectedStore, generateId = randomUUID, logRequests = true, config = defaults, sandboxClient, abhaProvider: injectedAbhaProvider, bridge: injectedBridge = {} }) {
  const app = express();
  // Shared state (ABDM transactions, callbacks, consents, records): memory in tests, encrypted Postgres otherwise.
  const store = injectedStore || createStateStore({ config, repo });

  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.use(requestId);
  // When the dashboard is served from here, the ABHA card is shown from a blob: URL, so images may come from blob:.
  app.use(
    config.serveFrontend
      ? helmet({ contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'img-src': ["'self'", 'data:', 'blob:'] } } })
      : helmet()
  );
  // Browsers may only call the API from the configured frontend origin.
  // Requests without an Origin header (curl, server-to-server) are still served; CORS only restricts browsers.
  app.use(cors({ origin: (origin, cb) => cb(null, origin === config.corsOrigin) }));
  // The data push route parses its own (larger) body; every other route gets the small default limit.
  const smallJson = express.json({ limit: '100kb' });
  app.use((req, res, next) => (req.path.startsWith('/api/v3/hiu/data-push/') ? next() : smallJson(req, res, next)));
  if (logRequests) app.use(requestLogger);

  const tokens = createTokenService({ secret: config.jwtSecret, expiresIn: config.jwtExpiresIn });
  const requireAuth = authenticate({ tokens });
  const generalLimiter = createLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.max });
  // Much stricter on login to slow down password guessing.
  const loginLimiter = createLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.loginMax });

  // Own limiter for the ABHA routes: stricter than general traffic, roomy enough for a full creation run.
  const abhaLimiter = createLimiter({ windowMs: config.rateLimit.windowMs, max: Math.min(config.rateLimit.max, 40) });

  const childService = createChildService({ repo, generateId });
  const reminderService = createReminderService({ repo });

  // Public: /health (for load balancer checks) and the mock login. Everything else needs a token.
  const abdmService = createAbdmService({
    repo,
    gateway: createMockGateway(config.abdm),
    config,
    store,
  });

  const auditService = createAuditService({ repo });

  // The real sandbox client exists only when ABDM_MODE=sandbox (or a test injects a fake one).
  // Creating it checks the credentials and that the host is the sandbox, not production.
  const sandbox =
    sandboxClient || (config.abdm.mode === 'sandbox' ? createSandboxClient({ config: config.abdm }) : null);

  // ABHA (M1) provider: the mock one unless ABDM_MODE=sandbox. Tests may inject their own.
  const abhaProvider =
    injectedAbhaProvider ||
    createAbhaProvider({
      config: { ...config.abdm, abhaBaseUrl: config.abdm.abhaBaseUrl || 'https://abhasbx.abdm.gov.in', mode: sandbox ? 'sandbox' : 'mock' },
      sandboxClient: sandbox,
    });
  const abhaService = createAbhaService({ repo, provider: abhaProvider, store });

  // M2 as a HIP and the bridge that receives ABDM's callbacks. The facility list is re-read per call so a
  // changed file applies without a restart; a missing file means no facilities and every callback is refused.
  const facilities = injectedBridge.facilities || (() => loadFacilities(config.abdm.facilitiesFile));
  const pending = injectedBridge.pending || createPendingRequests({ store });
  const hipClient = injectedBridge.hipClient || (sandbox && config.abdm.mode === 'sandbox' ? createHipClient({ config: config.abdm, sandboxClient: sandbox }) : null);
  const hipLinking = createHipLinkingService({ repo, hipClient, pending, facilities, store });
  const defer = injectedBridge.defer || ((fn) => { setImmediate(fn); });
  const hiu = createHiuService({ repo, hipClient, pending, facilities, store, publicBaseUrl: () => injectedBridge.publicBaseUrl || config.abdm.publicBaseUrl || '', defer });
  const hipData = createHipDataService({ repo, hipClient, store, safePushUrl: injectedBridge.safePushUrl || safePushUrl });
  const callbackGuard = createCallbackGuard({ facilityIds: () => idsOf(facilities()) });

  app.use('/health', healthRouter({ repo }));
  // The mock login hands out tokens to synthetic users, so it must never exist in production.
  // With it off, production has no way to log in until a real identity provider is added.
  // A staging/demo deployment may turn it on with ALLOW_MOCK_LOGIN=1, but only behind a network restriction
  // (the load balancer lets only listed addresses reach it; see infra/).
  if (config.nodeEnv !== 'production' || config.allowMockLogin) {
    app.use('/auth', authRouter({ tokens, loginLimiter }));
  }
  app.use('/children', generalLimiter, requireAuth, childrenRouter({ childService }));
  app.use('/reminders', generalLimiter, requireAuth, remindersRouter({ reminderService }));

  // Real ABDM sandbox checks (off unless ABDM_MODE=sandbox).
  app.use('/sandbox', generalLimiter, requireAuth, sandboxRouter({ sandboxClient: sandbox }));

  // REAL ABDM sandbox: M1 create ABHA by Aadhaar OTP. Needs ABDM_MODE=sandbox.
  app.use('/abha', requireAuth, abhaRouter({ abhaService, auditService, limiter: abhaLimiter }));

  // MOCK ABDM prototype (synthetic data, no connection to the real ABDM).
  app.use('/abdm', generalLimiter, requireAuth, abdmRouter({ abdmService, auditService }));

  // M2 as a HIP (REAL sandbox): guardian-facing calls, and the bridge ABDM calls back.
  app.use('/hip', generalLimiter, requireAuth, hipRouter({ hipLinking, auditService }));
  app.use('/hiu', generalLimiter, requireAuth, hiuRouter({ hiu, auditService }));
  app.use(bridgeRouter({ guard: callbackGuard, pending, hipLinking, hipData, hiu, hipClient, defer, store }));

  // The built dashboard, for a one-address demo. API routes above take precedence.
  if (config.serveFrontend) app.use(express.static(config.frontendDist));

  app.use(notFoundHandler);
  app.use(errorHandler);
  app.locals.store = store;
  return app;
}

module.exports = { createApp };
