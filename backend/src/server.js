const config = require('./config');
const { createApp } = require('./app');
const { createRepository } = require('./repositories');

const repo = createRepository(config);
const app = createApp({ repo });

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
