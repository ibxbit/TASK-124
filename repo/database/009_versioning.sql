CREATE TABLE IF NOT EXISTS app_versions (
  id             SERIAL PRIMARY KEY,
  version        VARCHAR(32)  NOT NULL UNIQUE,
  manifest       JSONB        NOT NULL,
  package_path   VARCHAR(512) NOT NULL,
  checksum       VARCHAR(128) NOT NULL,
  status         VARCHAR(16)  NOT NULL DEFAULT 'imported'
                 CHECK (status IN ('imported','installed','rolled_back','failed')),
  imported_by    INTEGER      REFERENCES users(id),
  imported_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  installed_at   TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id             BIGSERIAL PRIMARY KEY,
  version_id     INTEGER      NOT NULL REFERENCES app_versions(id) ON DELETE RESTRICT,
  name           VARCHAR(128) NOT NULL,
  up_sql         TEXT         NOT NULL,
  down_sql       TEXT         NOT NULL,
  applied_at     TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,
  UNIQUE (version_id, name)
);
CREATE INDEX IF NOT EXISTS idx_schema_mig_version ON schema_migrations(version_id, applied_at);

-- DOWN
-- DROP VIEW IF EXISTS v_versions;
-- DROP TABLE IF EXISTS schema_migrations;
-- DROP TABLE IF EXISTS app_versions;
