-- Audit trail for the MOCK ABDM actions. Kept separate from HTTP access logs.
-- It stores references only: never ABHA numbers, OTPs, tokens, secrets or health records.
CREATE TABLE audit_events (
  id                UUID PRIMARY KEY,
  request_id        UUID,
  event_type        VARCHAR(40) NOT NULL,
  actor_guardian_id UUID        NOT NULL,
  child_id          UUID,
  consent_id        UUID,
  outcome           VARCHAR(10) NOT NULL CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILURE')),
  reason_code       VARCHAR(60),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No foreign keys on purpose: an audit record must survive even if the child row is deleted.
CREATE INDEX idx_audit_child_actor ON audit_events (child_id, actor_guardian_id, created_at);
