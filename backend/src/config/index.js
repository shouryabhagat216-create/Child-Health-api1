require('dotenv').config();
const path = require('path');

const nodeEnv = process.env.NODE_ENV || 'development';

// Dev-only fallback so the project runs without setup. Refused in production below.
const DEV_JWT_SECRET = 'dev-only-insecure-secret-change-me';
const jwtSecret = process.env.JWT_SECRET || DEV_JWT_SECRET;

if (nodeEnv === 'production' && jwtSecret === DEV_JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv,
  dbMode: process.env.DB_MODE || 'postgres',
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgres://childhealth:childhealth@localhost:5432/childhealth',
  // Number of reverse proxies in front of the app (a tunnel or load balancer = 1). Needed so rate
  // limiting sees the real client IP. Leave unset when running with no proxy.
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : false,
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  // Only this origin (the React dev server by default) may call the API from a browser.
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  // Mock ABDM gateway behaviour (see src/abdm/mockGateway.js) plus the optional REAL sandbox client.
  abdm: {
    mode: process.env.ABDM_MODE === 'sandbox' ? 'sandbox' : 'mock',
    clientId: process.env.ABDM_CLIENT_ID || '',
    clientSecret: process.env.ABDM_CLIENT_SECRET || '',
    gatewayBaseUrl: process.env.ABDM_GATEWAY_BASE_URL || 'https://dev.abdm.gov.in',
    // ABHA (M1) service, a different host from the gateway above.
    abhaBaseUrl: process.env.ABDM_ABHA_BASE_URL || 'https://abhasbx.abdm.gov.in',
    // Facilities this software serves (git-ignored file; see src/abdm/facilities.js).
    facilitiesFile: process.env.ABDM_FACILITIES_FILE || path.join(__dirname, '../../config/facilities.json'),
    // Public https address of this server (the bridge). The data push URLs we give to providers are built from it.
    publicBaseUrl: (process.env.ABDM_PUBLIC_BASE_URL || '').replace(/\/$/, ''),
    cmId: process.env.ABDM_CM_ID || 'sbx',
    timeoutMs: 10000,
    maxAttempts: Number(process.env.ABDM_MOCK_MAX_ATTEMPTS) || 3,
    retryDelayMs: process.env.ABDM_MOCK_RETRY_DELAY_MS ? Number(process.env.ABDM_MOCK_RETRY_DELAY_MS) : 200,
    consentDefaultDays: 30,
    consentMaxDays: 90, // data minimisation: consent cannot be requested for longer than this
  },
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX) || 300,
    loginMax: Number(process.env.RATE_LIMIT_LOGIN_MAX) || 10,
  },
};
