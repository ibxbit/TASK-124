-- Safe-rollback enhancements: per-migration checksum, pre-update snapshot registry,
-- and a normalized "version table" view matching the (id, version, applied_at, status) shape.

ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum   VARCHAR(128);
ALTER TABLE app_versions      ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

-- Pre-update database snapshots (one per apply; referenced on rollback)
CREATE TABLE IF NOT EXISTS app_snapshots (
  id           SERIAL PRIMARY KEY,
  version_id   INTEGER      REFERENCES app_versions(id) ON DELETE SET NULL,
  pre_version  VARCHAR(32),                      -- version installed at time of snapshot
  file_path    VARCHAR(512) NOT NULL,
  size_bytes   BIGINT       NOT NULL,
  checksum     VARCHAR(128) NOT NULL,            -- sha256 of snapshot file
  schema_hash  VARCHAR(128) NOT NULL,            -- sha256 of schema at snapshot time
  metadata     JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_by   INTEGER      REFERENCES users(id),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_app_snapshots_version ON app_snapshots(version_id);

-- "Version table" view: (id, version, applied_at, status) with normalized status values.
--   installed   → 'active'
--   rolled_back → 'rolled_back'
-- other internal states (imported, failed) are excluded from the public view.
CREATE OR REPLACE VIEW v_versions AS
  SELECT id,
         version,
         COALESCE(applied_at, installed_at) AS applied_at,
         CASE WHEN status = 'installed'   THEN 'active'
              WHEN status = 'rolled_back' THEN 'rolled_back'
              ELSE status
         END AS status
  FROM app_versions
  WHERE status IN ('installed','rolled_back');

-- DOWN
-- DROP VIEW IF EXISTS v_versions;
-- DROP TABLE IF EXISTS app_snapshots;
-- -- Note: applied_at and checksum columns added via ALTER are typically left 
-- -- as-is in baseline rollbacks unless a full DROP of the table is performed.
