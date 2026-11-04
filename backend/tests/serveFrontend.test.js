const os = require('os');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { MemoryRepository } = require('../src/repositories/memoryRepository');
const { TEST_CONFIG } = require('./helpers/auth');

// The one-address demo: the dashboard is served by the API server. Off unless asked for; the API keeps working.
describe('serving the built dashboard', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Dashboard</title>');
  const make = (extra) => createApp({ repo: new MemoryRepository(), logRequests: false, config: { ...TEST_CONFIG, ...extra } });

  test('is off by default: no dashboard at /', async () => {
    await request(make({})).get('/').expect(404);
  });

  test('when on, / returns the page, the API still answers, and blob: images are allowed for the ABHA card', async () => {
    const app = make({ serveFrontend: true, frontendDist: dist });
    const page = await request(app).get('/').expect(200);
    expect(page.text).toContain('Dashboard');
    expect(page.headers['content-security-policy']).toMatch(/img-src[^;]*blob:/);
    await request(app).get('/health').expect(200);
    await request(app).get('/children').expect(401); // still needs a login
    await request(app).get('/no-such-file.js').expect(404);
  });
});
