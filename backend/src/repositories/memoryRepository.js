const { ConflictError, NotFoundError } = require('../errors');

// In-memory store. Used by the tests and by DB_MODE=memory (no database needed).
// It mirrors the constraints the Postgres schema enforces: unique child id, reminder -> child FK.
class MemoryRepository {
  constructor() {
    this.children = new Map();
    this.reminders = new Map();
    this.abhaLinks = new Map(); // keyed by child id
    this.careContexts = new Map();
    this.consents = new Map();
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

  async listChildrenByGuardian(guardianId) {
    return [...this.children.values()]
      .filter((c) => c.guardianId === guardianId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => ({ ...c }));
  }

  async insertReminder(reminder) {
    if (!this.children.has(reminder.childId)) {
      throw new NotFoundError('CHILD_NOT_FOUND', `Child with id '${reminder.childId}' does not exist`);
    }
    this.reminders.set(reminder.id, { ...reminder });
    return { ...reminder };
  }

  // ---- MOCK ABDM data ----

  async upsertAbhaLink(link) {
    const existing = this.abhaLinks.get(link.childId);
    const saved = { ...link, id: existing ? existing.id : link.id };
    this.abhaLinks.set(link.childId, saved);
    return { ...saved };
  }

  async findAbhaLinkByChildId(childId) {
    const link = this.abhaLinks.get(childId);
    return link ? { ...link } : null;
  }

  async insertCareContext(cc) {
    const duplicate = [...this.careContexts.values()].some(
      (c) => c.childId === cc.childId && c.reference === cc.reference
    );
    if (duplicate) throw new ConflictError(`Care context '${cc.reference}' is already linked`);
    this.careContexts.set(cc.id, { ...cc });
    return { ...cc };
  }

  async listCareContextsByChild(childId) {
    return [...this.careContexts.values()].filter((c) => c.childId === childId).map((c) => ({ ...c }));
  }

  async insertConsent(consent) {
    this.consents.set(consent.id, { ...consent });
    return { ...consent };
  }

  async findConsentById(id) {
    const c = this.consents.get(id);
    return c ? { ...c, hiTypes: [...c.hiTypes] } : null;
  }

  async listConsentsByChild(childId) {
    return [...this.consents.values()]
      .filter((c) => c.childId === childId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => ({ ...c, hiTypes: [...c.hiTypes] }));
  }

  // patch: { status, decidedAt?, revokedAt? }
  async updateConsent(id, patch) {
    const current = this.consents.get(id);
    if (!current) return null;
    const updated = { ...current, ...patch };
    this.consents.set(id, updated);
    return { ...updated, hiTypes: [...updated.hiTypes] };
  }

  async ping() {
    return true;
  }

  async close() {}
}

module.exports = { MemoryRepository };
