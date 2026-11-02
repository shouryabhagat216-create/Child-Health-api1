const { ConflictError, NotFoundError } = require('../errors');

// In-memory store. Used by the tests and by DB_MODE=memory (no database needed).
// It mirrors the constraints the Postgres schema enforces: unique child id, reminder -> child FK.
class MemoryRepository {
  constructor() {
    this.children = new Map();
    this.reminders = new Map();
  }

  async insertChild(child) {
    if (this.children.has(child.id)) {
      throw new ConflictError(`Child id '${child.id}' already exists`);
    }
    this.children.set(child.id, { ...child });
    return { ...child };
  }

  async findChildById(id) {
    const child = this.children.get(id);
    return child ? { ...child } : null;
  }

  async insertReminder(reminder) {
    if (!this.children.has(reminder.childId)) {
      throw new NotFoundError('CHILD_NOT_FOUND', `Child with id '${reminder.childId}' does not exist`);
    }
    this.reminders.set(reminder.id, { ...reminder });
    return { ...reminder };
  }

  async ping() {
    return true;
  }

  async close() {}
}

module.exports = { MemoryRepository };
