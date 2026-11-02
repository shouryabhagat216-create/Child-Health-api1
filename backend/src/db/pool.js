const { Pool, types } = require('pg');

// Postgres DATE (OID 1082) would otherwise be parsed into a JS Date, which shifts
// with the server timezone. Keep it as the plain 'YYYY-MM-DD' string.
types.setTypeParser(1082, (value) => value);

function createPool(connectionString) {
  return new Pool({ connectionString });
}

module.exports = { createPool };
