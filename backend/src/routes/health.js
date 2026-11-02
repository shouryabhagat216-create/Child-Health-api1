const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const pkg = require('../../package.json');

function healthRouter({ repo }) {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      let database = 'up';
      try {
        await repo.ping();
      } catch {
        database = 'down';
      }
      const healthy = database === 'up';
      res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'degraded',
        service: pkg.name,
        version: pkg.version,
        database,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    })
  );

  return router;
}

module.exports = { healthRouter };
