const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../errors');

// Real ABDM SANDBOX checks. Disabled unless ABDM_MODE=sandbox. Not part of the mock.
function sandboxRouter({ sandboxClient }) {
  const router = express.Router();

  router.get(
    '/ping',
    asyncHandler(async (req, res) => {
      if (!sandboxClient) {
        throw new AppError(409, 'SANDBOX_NOT_ENABLED', 'Set ABDM_MODE=sandbox (with sandbox credentials) in .env and restart');
      }
      const result = await sandboxClient.ping();
      // Only success information; the token itself is never returned.
      res.set('X-ABDM-Mode', 'SANDBOX').json({ sandbox: true, ...result });
    })
  );

  return router;
}

module.exports = { sandboxRouter };
