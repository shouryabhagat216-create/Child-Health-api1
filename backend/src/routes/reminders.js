const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { createReminderSchema } = require('../validation/schemas');

function remindersRouter({ reminderService }) {
  const router = express.Router();

  // Create a vaccination reminder -> 201 Created, 400, 403 (consent revoked), 404 (unknown child)
  router.post(
    '/',
    validate('body', createReminderSchema),
    asyncHandler(async (req, res) => {
      const reminder = await reminderService.create(req.body, req.guardian.id);
      res.status(201).json(reminder);
    })
  );

  return router;
}

module.exports = { remindersRouter };
