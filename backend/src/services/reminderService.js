const { randomUUID } = require('crypto');
const { NotFoundError, ForbiddenError, ValidationError } = require('../errors');

function createReminderService({ repo }) {
  return {
    async create(input) {
      const child = await repo.findChildById(input.childId);
      if (!child) {
        throw new NotFoundError('CHILD_NOT_FOUND', `Child with id '${input.childId}' does not exist`);
      }
      // Data-minimisation / consent rule: no new processing once the guardian has revoked consent.
      if (child.consentStatus === 'revoked') {
        throw new ForbiddenError(
          'CONSENT_REVOKED',
          'Guardian consent has been revoked for this child; reminders cannot be created'
        );
      }
      if (input.dueDate < child.dateOfBirth) {
        throw new ValidationError('Request validation failed', [
          { field: 'dueDate', message: "must not be before the child's date of birth" },
        ]);
      }
      const reminder = { id: randomUUID(), ...input, createdAt: new Date().toISOString() };
      return repo.insertReminder(reminder);
    },
  };
}

module.exports = { createReminderService };
