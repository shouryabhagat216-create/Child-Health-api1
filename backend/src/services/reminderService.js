const { randomUUID } = require('crypto');
const { ForbiddenError, ValidationError } = require('../errors');
const { findOwnedChild } = require('./ownership');

function createReminderService({ repo }) {
  return {
    async create(input, guardianId) {
      // 404 if the child does not exist OR belongs to another guardian.
      const child = await findOwnedChild(repo, input.childId, guardianId);
      // NOTE: consentStatus 'pending' is deliberately still allowed (only 'revoked' blocks). Revisit for production.
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
