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

-- Distributed login throttle: one row per (ip:username) key, shared across
-- serverless instances. `reset_at` is the end of the current sliding window;
-- a request past it starts a fresh window.
CREATE TABLE IF NOT EXISTS login_attempts (
  key       TEXT PRIMARY KEY,
  fail_count INT NOT NULL DEFAULT 0,
  reset_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS login_attempts_reset_at_idx ON login_attempts (reset_at);

-- Last hold selection sent to the Garmin watch ("Send to watch" button).
-- Also created lazily by /api/watch on first use.
CREATE TABLE IF NOT EXISTS watch_selection (
  id      INT PRIMARY KEY DEFAULT 1,
  holds   JSONB NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT watch_selection_single_row CHECK (id = 1)
);
