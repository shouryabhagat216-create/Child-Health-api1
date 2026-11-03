const { findOwnedChild } = require('./ownership');

// The owner id is internal; API responses do not include it.
const toPublic = ({ guardianId, ...child }) => child;

// Business logic lives here, separate from HTTP (routes) and storage (repositories).
function createChildService({ repo, generateId }) {
  return {
    // guardianId comes from the verified token, never from the request body.
    async register(input, guardianId) {
      const child = { id: generateId(), ...input, guardianId, createdAt: new Date().toISOString() };
      return toPublic(await repo.insertChild(child)); // throws ConflictError (409) if the id already exists
    },

    async getById(id, guardianId) {
      return toPublic(await findOwnedChild(repo, id, guardianId));
    },

    async listForGuardian(guardianId) {
      return (await repo.listChildrenByGuardian(guardianId)).map(toPublic);
    },
  };
}

module.exports = { createChildService };
