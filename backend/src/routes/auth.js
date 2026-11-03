const express = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { UnauthorizedError } = require('../errors');
const { findByCredentials } = require('../auth/mockGuardians');

const loginSchema = z
  .object({
    username: z.string({ required_error: 'is required' }).min(1, 'must not be empty').max(100),
    password: z.string({ required_error: 'is required' }).min(1, 'must not be empty').max(100),
  })
  .strict();

// MOCK login for synthetic guardians only - NOT production auth (see auth/mockGuardians.js).
function authRouter({ tokens, loginLimiter }) {
  const router = express.Router();

  router.post('/mock-login', loginLimiter, validate('body', loginSchema), (req, res, next) => {
    const guardian = findByCredentials(req.body.username, req.body.password);
    if (!guardian) return next(new UnauthorizedError('Invalid username or password'));
    return res.json({
      token: tokens.sign(guardian.id),
      tokenType: 'Bearer',
      guardian: { id: guardian.id, displayName: guardian.displayName },
      notice: 'MOCK authentication with synthetic guardians - not production auth',
    });
  });

  return router;
}

module.exports = { authRouter };
