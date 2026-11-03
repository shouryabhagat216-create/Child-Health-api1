const supertest = require('supertest');
const { createTokenService } = require('../../src/auth/tokens');
const { MOCK_GUARDIANS } = require('../../src/auth/mockGuardians');

// Fixed test config so tests never depend on a developer's real .env file.
const TEST_CONFIG = {
  jwtSecret: 'test-only-secret',
  jwtExpiresIn: '1h',
  corsOrigin: 'http://localhost:5173',
  rateLimit: { windowMs: 60 * 1000, max: 1000, loginMax: 1000 },
};

const tokens = createTokenService({ secret: TEST_CONFIG.jwtSecret });
const [NEHA, ROHIT] = MOCK_GUARDIANS;

// Same call shape as supertest's request(app), but every request is sent as a logged-in guardian.
// This is how the original 17 test scenarios keep working unchanged now that auth is required.
const authedRequest = (app, guardian = NEHA) =>
  supertest.agent(app).set('Authorization', `Bearer ${tokens.sign(guardian.id)}`);

module.exports = { TEST_CONFIG, tokens, authedRequest, NEHA, ROHIT, anonymousRequest: supertest };
