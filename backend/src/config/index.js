require('dotenv').config();

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
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  // Only this origin (the React dev server by default) may call the API from a browser.
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  // Mock ABDM gateway behaviour (see src/abdm/mockGateway.js).
  abdm: {
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
