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

  async ping() {
    await this.pool.query('SELECT 1');
    return true;
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = { PostgresRepository };
