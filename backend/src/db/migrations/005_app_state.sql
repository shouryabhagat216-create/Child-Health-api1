-- Shared, short-lived application state (ABDM transactions, pending callbacks, consents, received records).
-- Every value is encrypted by the application (AES-256-GCM) before it is written, so the database never holds
-- tokens or records in the clear. No Aadhaar number or OTP is ever written here.
CREATE TABLE app_state (
  namespace  TEXT        NOT NULL,
  key        TEXT        NOT NULL,
  value      BYTEA       NOT NULL,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (namespace, key)
);

CREATE INDEX idx_app_state_expiry ON app_state (expires_at) WHERE expires_at IS NOT NULL;
