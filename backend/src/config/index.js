require('dotenv').config();

module.exports = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  dbMode: process.env.DB_MODE || 'postgres',
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgres://childhealth:childhealth@localhost:5432/childhealth',
};
