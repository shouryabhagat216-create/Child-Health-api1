const { NotFoundError } = require('../errors');

// Business logic lives here, separate from HTTP (routes) and storage (repositories).
function createChildService({ repo, generateId }) {
  return {
    async register(input) {
      const child = { id: generateId(), ...input, createdAt: new Date().toISOString() };
      return repo.insertChild(child); // throws ConflictError (409) if the id already exists
    },

    async getById(id) {
      const child = await repo.findChildById(id);
      if (!child) {
        throw new NotFoundError('CHILD_NOT_FOUND', `Child with id '${id}' does not exist`);
      }
      return child;
    },
  };
}

module.exports = { createChildService };
