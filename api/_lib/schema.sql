-- Angles shared-backend schema (Phase 1). Idempotent: safe to run repeatedly.

CREATE TABLE IF NOT EXISTS users (
  username   TEXT PRIMARY KEY,
  pass_hash  TEXT NOT NULL,
  salt       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_state (
  id         INT PRIMARY KEY DEFAULT 1,
  data       JSONB NOT NULL,
  revision   BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT app_state_single_row CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS change_log (
  id         BIGSERIAL PRIMARY KEY,
  username   TEXT NOT NULL,
  action     TEXT NOT NULL,
  entity     TEXT,
  field      TEXT,
  old_value  TEXT,
  new_value  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS change_log_created_at_idx ON change_log (created_at DESC);
