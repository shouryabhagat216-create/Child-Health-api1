const { NotFoundError } = require('../errors');

// Loads a child only if it belongs to the guardian.
// A child owned by someone else gives exactly the same 404 as a child that does not exist,
// so one parent cannot even find out which child ids exist.
async function findOwnedChild(repo, childId, guardianId) {
  const child = await repo.findChildById(childId);
  if (!child || child.guardianId !== guardianId) {
    throw new NotFoundError('CHILD_NOT_FOUND', `Child with id '${childId}' does not exist`);
  }
  return child;
}

module.exports = { findOwnedChild };
