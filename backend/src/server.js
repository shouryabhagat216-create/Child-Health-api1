const config = require('./config');
const { createApp } = require('./app');
const { createRepository } = require('./repositories');
const { createStateStore } = require('./state/stateStore');

const repo = createRepository(config);
const store = createStateStore({ config, repo });
const app = createApp({ repo, store, config });

// Expired rows are never returned, but they still take space: sweep them every ten minutes.
const sweep = setInterval(() => {
  store.purgeExpired().catch((err) => console.error(JSON.stringify({ level: 'error', event: 'state_purge_failed', name: err.name })));
}, 10 * 60 * 1000);
sweep.unref();

const server = app.listen(config.port, () => {
  console.log(`Child Health API listening on port ${config.port} (db mode: ${config.dbMode})`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await repo.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
