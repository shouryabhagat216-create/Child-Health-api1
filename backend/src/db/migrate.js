const fs = require('fs');
const path = require('path');
const config = require('../config');
const { createPool } = require('./pool');

// Minimal migration runner: applies each .sql file in ./migrations once, in name order.
async function migrate() {
  const pool = createPool(config.databaseUrl);
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );
    const dir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      const { rowCount } = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (rowCount) continue;

      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`applied migration ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
    console.log('migrations up to date');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  migrate().catch((err) => {
    console.error('migration failed:', err.message);
    process.exit(1);
  });
}

module.exports = { migrate };
