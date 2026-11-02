CREATE TABLE children (
  id             UUID PRIMARY KEY,
  name           VARCHAR(100) NOT NULL,
  date_of_birth  DATE         NOT NULL,
  guardian_name  VARCHAR(100) NOT NULL,
  state          VARCHAR(60)  NOT NULL,
  consent_status VARCHAR(10)  NOT NULL
                 CHECK (consent_status IN ('pending', 'granted', 'revoked')),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE reminders (
  id              UUID PRIMARY KEY,
  child_id        UUID         NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  vaccine_name    VARCHAR(100) NOT NULL,
  due_date        DATE         NOT NULL,
  reminder_status VARCHAR(12)  NOT NULL
                  CHECK (reminder_status IN ('scheduled', 'sent', 'completed', 'cancelled')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_reminders_child_id ON reminders (child_id);
