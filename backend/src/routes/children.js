const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { registerChildSchema, childIdParamSchema } = require('../validation/schemas');

function childrenRouter({ childService }) {
  const router = express.Router();

  // Register a child -> 201 Created
  router.post(
    '/',
    validate('body', registerChildSchema),
    asyncHandler(async (req, res) => {
      const child = await childService.register(req.body);
      res.status(201).location(`/children/${child.id}`).json(child);
    })
  );

  // Retrieve a child's profile -> 200 OK, 400 bad id, 404 not found
  router.get(
    '/:id',
    validate('params', childIdParamSchema),
    asyncHandler(async (req, res) => {
      res.json(await childService.getById(req.params.id));
    })
  );

  return router;
}

module.exports = { childrenRouter };
