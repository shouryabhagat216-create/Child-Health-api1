const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { registerChildSchema, childIdParamSchema } = require('../validation/schemas');

function childrenRouter({ childService }) {
  const router = express.Router();

  // List only the logged-in guardian's own children -> 200
  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json({ children: await childService.listForGuardian(req.guardian.id) });
    })
  );

  // Register a child (owned by the logged-in guardian) -> 201 Created
  router.post(
    '/',
    validate('body', registerChildSchema),
    asyncHandler(async (req, res) => {
      const child = await childService.register(req.body, req.guardian.id);
      res.status(201).location(`/children/${child.id}`).json(child);
    })
  );

  // Retrieve a child's profile -> 200 OK, 400 bad id, 404 not found or not yours
  router.get(
    '/:id',
    validate('params', childIdParamSchema),
    asyncHandler(async (req, res) => {
      res.json(await childService.getById(req.params.id, req.guardian.id));
    })
  );

  return router;
}

module.exports = { childrenRouter };
