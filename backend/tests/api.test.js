// Requests are sent as a logged-in synthetic guardian (see tests/helpers/auth.js).
const { authedRequest: request, TEST_CONFIG } = require('./helpers/auth');
const { createApp } = require('../src/app');
const { MemoryRepository } = require('../src/repositories/memoryRepository');

// All data below is synthetic.
const validChild = {
  name: 'Aarav Sharma',
  dateOfBirth: '2024-03-15',
  guardianName: 'Neha Sharma',
  state: 'Maharashtra',
  consentStatus: 'granted',
};

const makeApp = (options = {}) =>
  createApp({ repo: new MemoryRepository(), logRequests: false, config: TEST_CONFIG, ...options });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNKNOWN_ID = '22222222-2222-4222-8222-222222222222';

describe('GET /health', () => {
  test('returns 200 and ok status', async () => {
    const res = await request(makeApp()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('up');
  });
});

describe('POST /children', () => {
  test('registers a child and returns 201 with a generated id', async () => {
    const res = await request(makeApp()).post('/children').send(validChild).expect(201);
    expect(res.body.id).toMatch(UUID);
    expect(res.body).toMatchObject(validChild);
    expect(res.headers.location).toBe(`/children/${res.body.id}`);
  });

  test('returns 400 listing every missing mandatory field', async () => {
    const res = await request(makeApp()).post('/children').send({}).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d) => d.field).sort();
    expect(fields).toEqual(['consentStatus', 'dateOfBirth', 'guardianName', 'name', 'state']);
  });

  test('returns 400 for a malformed date of birth', async () => {
    const res = await request(makeApp())
      .post('/children')
      .send({ ...validChild, dateOfBirth: '15-03-2024' })
      .expect(400);
    expect(res.body.error.details[0]).toEqual({
      field: 'dateOfBirth',
      message: 'must be in YYYY-MM-DD format',
    });
  });

  test('returns 400 for an impossible calendar date and for a future date', async () => {
    const app = makeApp();
    await request(app).post('/children').send({ ...validChild, dateOfBirth: '2024-02-30' }).expect(400);
    await request(app).post('/children').send({ ...validChild, dateOfBirth: '2999-01-01' }).expect(400);
  });

  test('returns 400 when the client tries to supply its own id', async () => {
    const res = await request(makeApp())
      .post('/children')
      .send({ ...validChild, id: '11111111-1111-4111-8111-111111111111' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('returns 400 for malformed JSON', async () => {
    const res = await request(makeApp())
      .post('/children')
      .set('Content-Type', 'application/json')
      .send('{"name": ')
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  test('returns 409 when the generated child id already exists', async () => {
    const FIXED_ID = '11111111-1111-4111-8111-111111111111';
    const app = makeApp({ generateId: () => FIXED_ID });
    await request(app).post('/children').send(validChild).expect(201);
    const res = await request(app).post('/children').send(validChild).expect(409);
    expect(res.body.error.code).toBe('DUPLICATE_RESOURCE');
  });
});

describe('GET /children/:id', () => {
  test('returns the child profile', async () => {
    const app = makeApp();
    const created = await request(app).post('/children').send(validChild).expect(201);
    const res = await request(app).get(`/children/${created.body.id}`).expect(200);
    expect(res.body).toEqual(created.body);
  });

  test('returns 404 with a clear error when the child does not exist', async () => {
    const res = await request(makeApp()).get(`/children/${UNKNOWN_ID}`).expect(404);
    expect(res.body.error.code).toBe('CHILD_NOT_FOUND');
    expect(res.body.error.message).toContain(UNKNOWN_ID);
  });

  test('returns 400 when the id is not a UUID', async () => {
    const res = await request(makeApp()).get('/children/not-a-uuid').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /reminders', () => {
  const registerChild = async (app, overrides = {}) =>
    (await request(app).post('/children').send({ ...validChild, ...overrides }).expect(201)).body;

  test('creates a reminder with default status "scheduled"', async () => {
    const app = makeApp();
    const child = await registerChild(app);
    const res = await request(app)
      .post('/reminders')
      .send({ childId: child.id, vaccineName: 'MMR-1', dueDate: '2025-03-15' })
      .expect(201);
    expect(res.body).toMatchObject({
      childId: child.id,
      vaccineName: 'MMR-1',
      dueDate: '2025-03-15',
      reminderStatus: 'scheduled',
    });
  });

  test('returns 404 when the child does not exist', async () => {
    const res = await request(makeApp())
      .post('/reminders')
      .send({ childId: UNKNOWN_ID, vaccineName: 'BCG', dueDate: '2025-01-01' })
      .expect(404);
    expect(res.body.error.code).toBe('CHILD_NOT_FOUND');
  });

  test('returns 400 for a bad due date and for an unknown reminder status', async () => {
    const app = makeApp();
    const child = await registerChild(app);
    await request(app)
      .post('/reminders')
      .send({ childId: child.id, vaccineName: 'BCG', dueDate: 'tomorrow' })
      .expect(400);
    await request(app)
      .post('/reminders')
      .send({ childId: child.id, vaccineName: 'BCG', dueDate: '2025-01-01', reminderStatus: 'done' })
      .expect(400);
  });

  test('returns 400 when the due date is before the date of birth', async () => {
    const app = makeApp();
    const child = await registerChild(app);
    const res = await request(app)
      .post('/reminders')
      .send({ childId: child.id, vaccineName: 'BCG', dueDate: '2020-01-01' })
      .expect(400);
    expect(res.body.error.details[0].field).toBe('dueDate');
  });

  test('returns 403 when guardian consent has been revoked', async () => {
    const app = makeApp();
    const child = await registerChild(app, { consentStatus: 'revoked' });
    const res = await request(app)
      .post('/reminders')
      .send({ childId: child.id, vaccineName: 'BCG', dueDate: '2025-01-01' })
      .expect(403);
    expect(res.body.error.code).toBe('CONSENT_REVOKED');
  });
});

describe('unknown routes', () => {
  test('return a JSON 404', async () => {
    const res = await request(makeApp()).get('/nope').expect(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});
