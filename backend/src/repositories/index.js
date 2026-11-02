const { MemoryRepository } = require('./memoryRepository');
const { PostgresRepository } = require('./postgresRepository');
const { createPool } = require('../db/pool');

function createRepository(config) {
  if (config.dbMode === 'memory') {
    console.log('Using in-memory repository (data is lost on restart)');
    return new MemoryRepository();
  }
  return new PostgresRepository(createPool(config.databaseUrl));
}

module.exports = { createRepository };
