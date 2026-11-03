-- Tables for the MOCK ABDM prototype. Synthetic data only.
-- The full ABHA number is never stored, only a masked form.

CREATE TABLE abha_links (
  id                 UUID PRIMARY KEY,
  child_id           UUID         NOT NULL UNIQUE REFERENCES children (id) ON DELETE CASCADE,
  abha_number_masked VARCHAR(20)  NOT NULL,
  abha_address       VARCHAR(100) NOT NULL,
  verified_at        TIMESTAMPTZ  NOT NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE care_contexts (
  id         UUID PRIMARY KEY,
  child_id   UUID         NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  reference  VARCHAR(100) NOT NULL,
  display    VARCHAR(200) NOT NULL,
  linked_at  TIMESTAMPTZ  NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (child_id, reference)
);

-- Per-request ABDM consent. This is separate from children.consent_status, which is the
-- guardian's consent to WombTo18 processing the child's data at all.
CREATE TABLE consents (
  id             UUID PRIMARY KEY,
  child_id       UUID         NOT NULL REFERENCES children (id) ON DELETE CASCADE,
  requester_name VARCHAR(100) NOT NULL,
  purpose        VARCHAR(10)  NOT NULL,
  hi_types       TEXT[]       NOT NULL,
  date_from      DATE         NOT NULL,
  date_to        DATE         NOT NULL,
  expires_at     TIMESTAMPTZ  NOT NULL,
  status         VARCHAR(10)  NOT NULL
                 CHECK (status IN ('REQUESTED', 'GRANTED', 'DENIED', 'REVOKED', 'EXPIRED')),
  decided_at     TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_consents_child_id ON consents (child_id);
