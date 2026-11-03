const { createApp } = require('../src/app');
const { MemoryRepository } = require('../src/repositories/memoryRepository');
const { TEST_CONFIG, tokens, authedRequest, anonymousRequest, NEHA, ROHIT } = require('./helpers/auth');

// All data below is synthetic.
const validChild = {
  name: 'Aarav Sharma',
  dateOfBirth: '2024-03-15',
  guardianName: 'Neha Sharma',
  state: 'Maharashtra',
  consentStatus: 'granted',
};

const makeApp = (config = TEST_CONFIG) =>
  createApp({ repo: new MemoryRepository(), logRequests: false, config });

const registerAs = async (app, guardian) =>
  (await authedRequest(app, guardian).post('/children').send(validChild).expect(201)).body;

describe('authentication', () => {
  test('protected routes return 401 without a token', async () => {
    const app = makeApp();
    for (const [method, path] of [['get', '/children'], ['post', '/children'], ['post', '/reminders']]) {
      const res = await anonymousRequest(app)[method](path).expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  test('rejects a garbage token and a token signed with another secret', async () => {
    const app = makeApp();
    await anonymousRequest(app).get('/children').set('Authorization', 'Bearer not-a-token').expect(401);
    const forged = require('jsonwebtoken').sign({ sub: NEHA.id }, 'some-other-secret');
    await anonymousRequest(app).get('/children').set('Authorization', `Bearer ${forged}`).expect(401);
  });

  test('rejects an expired token', async () => {
    const expired = require('jsonwebtoken').sign({ sub: NEHA.id }, TEST_CONFIG.jwtSecret, { expiresIn: -10 });
    await anonymousRequest(makeApp()).get('/children').set('Authorization', `Bearer ${expired}`).expect(401);
  });

  test('/health stays public', async () => {
    await anonymousRequest(makeApp()).get('/health').expect(200);
  });

  test('mock login returns a token that works, and rejects wrong passwords', async () => {
    const app = makeApp();
    const ok = await anonymousRequest(app)
      .post('/auth/mock-login')
      .send({ username: NEHA.username, password: NEHA.password })
      .expect(200);
    expect(tokens.verify(ok.body.token)).toBe(NEHA.id);
    await anonymousRequest(app).get('/children').set('Authorization', `Bearer ${ok.body.token}`).expect(200);

    const bad = await anonymousRequest(app)
      .post('/auth/mock-login')
      .send({ username: NEHA.username, password: 'wrong' })
      .expect(401);
    expect(bad.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('guardian ownership', () => {
  test("another guardian gets 404 for a child, identical to a nonexistent child", async () => {
    const app = makeApp();
    const child = await registerAs(app, NEHA);
    const res = await authedRequest(app, ROHIT).get(`/children/${child.id}`).expect(404);
    expect(res.body.error.code).toBe('CHILD_NOT_FOUND');
    await authedRequest(app, NEHA).get(`/children/${child.id}`).expect(200);
  });

  test("another guardian cannot create a reminder for someone else's child", async () => {
    const app = makeApp();
    const child = await registerAs(app, NEHA);
    const res = await authedRequest(app, ROHIT)
      .post('/reminders')
      .send({ childId: child.id, vaccineName: 'BCG', dueDate: '2025-01-01' })
      .expect(404);
    expect(res.body.error.code).toBe('CHILD_NOT_FOUND');
  });

  test('the list endpoint only returns the logged-in guardian\'s children', async () => {
    const app = makeApp();
    const mine = await registerAs(app, NEHA);
    await registerAs(app, ROHIT);
    const res = await authedRequest(app, NEHA).get('/children').expect(200);
    expect(res.body.children.map((c) => c.id)).toEqual([mine.id]);
  });

  test('responses never expose the internal guardianId', async () => {
    const app = makeApp();
    const child = await registerAs(app, NEHA);
    expect(child).not.toHaveProperty('guardianId');
  });

  test('a client cannot choose the owner by sending guardianId', async () => {
    const res = await authedRequest(makeApp(), NEHA)
      .post('/children')
      .send({ ...validChild, guardianId: ROHIT.id })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('mock login in production', () => {
  test('is not available when NODE_ENV is production (404)', async () => {
    const app = makeApp({ ...TEST_CONFIG, nodeEnv: 'production' });
    await anonymousRequest(app)
      .post('/auth/mock-login')
      .send({ username: NEHA.username, password: NEHA.password })
      .expect(404);
  });
});

describe('rate limiting and CORS', () => {
  test('login is rate limited and returns the standard error shape (429)', async () => {
    const app = makeApp({ ...TEST_CONFIG, rateLimit: { windowMs: 60000, max: 1000, loginMax: 3 } });
    const attempt = () =>
      anonymousRequest(app).post('/auth/mock-login').send({ username: 'x', password: 'y' });
    for (let i = 0; i < 3; i += 1) await attempt().expect(401);
    const res = await attempt().expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  test('CORS allows only the configured frontend origin', async () => {
    const app = makeApp();
    const allowed = await anonymousRequest(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const other = await anonymousRequest(app).get('/health').set('Origin', 'http://evil.example');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});
