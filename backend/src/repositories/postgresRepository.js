const { ConflictError, NotFoundError } = require('../errors');

const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';

const toChild = (row) => ({
  id: row.id,
  name: row.name,
  dateOfBirth: row.date_of_birth,
  guardianName: row.guardian_name,
  state: row.state,
  consentStatus: row.consent_status,
  guardianId: row.guardian_id, // null for rows created before migration 002
  createdAt: row.created_at.toISOString(),
});

const toReminder = (row) => ({
  id: row.id,
  childId: row.child_id,
  vaccineName: row.vaccine_name,
  dueDate: row.due_date,
  reminderStatus: row.reminder_status,
  createdAt: row.created_at.toISOString(),
});

const iso = (value) => (value ? value.toISOString() : null);

const toAbhaLink = (row) => ({
  id: row.id,
  childId: row.child_id,
  abhaNumberMasked: row.abha_number_masked,
  abhaAddress: row.abha_address,
  verifiedAt: iso(row.verified_at),
});

const toCareContext = (row) => ({
  id: row.id,
  childId: row.child_id,
  reference: row.reference,
  display: row.display,
  linkedAt: iso(row.linked_at),
});

const toConsent = (row) => ({
  id: row.id,
  childId: row.child_id,
  requesterName: row.requester_name,
  purpose: row.purpose,
  hiTypes: row.hi_types,
  dateFrom: row.date_from,
  dateTo: row.date_to,
  expiresAt: iso(row.expires_at),
  status: row.status,
  decidedAt: iso(row.decided_at),
  revokedAt: iso(row.revoked_at),
  createdAt: iso(row.created_at),
});

// All queries are parameterized ($1, $2, ...) so user input is never concatenated into SQL.
class PostgresRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async insertChild(child) {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO children (id, name, date_of_birth, guardian_name, state, consent_status, guardian_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [child.id, child.name, child.dateOfBirth, child.guardianName, child.state, child.consentStatus, child.guardianId, child.createdAt]
      );
      return toChild(rows[0]);
    } catch (err) {
      if (err.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictError(`Child id '${child.id}' already exists`);
      }
      throw err;
    }
  }

  async findChildById(id) {
    const { rows } = await this.pool.query('SELECT * FROM children WHERE id = $1', [id]);
    return rows[0] ? toChild(rows[0]) : null;
  }

  async listChildrenByGuardian(guardianId) {
    const { rows } = await this.pool.query(
      'SELECT * FROM children WHERE guardian_id = $1 ORDER BY created_at, id',
      [guardianId]
    );
    return rows.map(toChild);
  }

  async insertReminder(reminder) {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO reminders (id, child_id, vaccine_name, due_date, reminder_status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [reminder.id, reminder.childId, reminder.vaccineName, reminder.dueDate, reminder.reminderStatus, reminder.createdAt]
      );
      return toReminder(rows[0]);
    } catch (err) {
      if (err.code === PG_FOREIGN_KEY_VIOLATION) {
        throw new NotFoundError('CHILD_NOT_FOUND', `Child with id '${reminder.childId}' does not exist`);
      }
      throw err;
    }
  }

  // ---- MOCK ABDM data ----

  async upsertAbhaLink(link) {
    const { rows } = await this.pool.query(
      `INSERT INTO abha_links (id, child_id, abha_number_masked, abha_address, verified_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (child_id) DO UPDATE
         SET abha_number_masked = EXCLUDED.abha_number_masked,
             abha_address = EXCLUDED.abha_address,
             verified_at = EXCLUDED.verified_at
       RETURNING *`,
      [link.id, link.childId, link.abhaNumberMasked, link.abhaAddress, link.verifiedAt]
    );
    return toAbhaLink(rows[0]);
  }

  async findAbhaLinkByChildId(childId) {
    const { rows } = await this.pool.query('SELECT * FROM abha_links WHERE child_id = $1', [childId]);
    return rows[0] ? toAbhaLink(rows[0]) : null;
  }

  async insertCareContext(cc) {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO care_contexts (id, child_id, reference, display, linked_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [cc.id, cc.childId, cc.reference, cc.display, cc.linkedAt]
      );
      return toCareContext(rows[0]);
    } catch (err) {
      if (err.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictError(`Care context '${cc.reference}' is already linked`);
      }
      throw err;
    }
  }

  async listCareContextsByChild(childId) {
    const { rows } = await this.pool.query(
      'SELECT * FROM care_contexts WHERE child_id = $1 ORDER BY linked_at, id',
      [childId]
    );
    return rows.map(toCareContext);
  }

  async insertConsent(c) {
    const { rows } = await this.pool.query(
      `INSERT INTO consents
         (id, child_id, requester_name, purpose, hi_types, date_from, date_to, expires_at, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [c.id, c.childId, c.requesterName, c.purpose, c.hiTypes, c.dateFrom, c.dateTo, c.expiresAt, c.status, c.createdAt]
    );
    return toConsent(rows[0]);
  }

  async findConsentById(id) {
    const { rows } = await this.pool.query('SELECT * FROM consents WHERE id = $1', [id]);
    return rows[0] ? toConsent(rows[0]) : null;
  }

  async listConsentsByChild(childId) {
    const { rows } = await this.pool.query(
      'SELECT * FROM consents WHERE child_id = $1 ORDER BY created_at, id',
      [childId]
    );
    return rows.map(toConsent);
  }

  // patch: { status, decidedAt?, revokedAt? }. COALESCE keeps the old value when a field is not given.
  async updateConsent(id, patch) {
    const { rows } = await this.pool.query(
      `UPDATE consents
          SET status = $2,
              decided_at = COALESCE($3, decided_at),
              revoked_at = COALESCE($4, revoked_at)
        WHERE id = $1 RETURNING *`,
      [id, patch.status, patch.decidedAt || null, patch.revokedAt || null]
    );
    return rows[0] ? toConsent(rows[0]) : null;
  }

  async ping() {
    await this.pool.query('SELECT 1');
    return true;
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = { PostgresRepository };
