-- Users + roles + audit log
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(64)  UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(32)  NOT NULL
    CHECK (role IN ('admin','analyst','moderator','finance')),
  active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER,
  role       VARCHAR(32),
  action     VARCHAR(128) NOT NULL,
  resource   VARCHAR(512),
  method     VARCHAR(8),
  status     VARCHAR(16)  NOT NULL CHECK (status IN ('allowed','denied')),
  reason     VARCHAR(128),
  ip         VARCHAR(64),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user    ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_no_update ON audit_log;
CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- DOWN
-- DROP TRIGGER IF EXISTS trg_audit_log_no_update ON audit_log;
-- DROP FUNCTION IF EXISTS audit_log_immutable();
-- DROP TABLE IF EXISTS audit_log;
-- DROP TABLE IF EXISTS users;
