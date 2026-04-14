-- Approved-machine allowlist for LAN-only mode.
-- Enforced at request boundary when LAN_ONLY=true.
CREATE TABLE IF NOT EXISTS lan_allowlist (
  id          SERIAL PRIMARY KEY,
  ip_address  VARCHAR(64)  NOT NULL UNIQUE,
  label       VARCHAR(128),
  added_by    INTEGER      REFERENCES users(id),
  active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lan_allowlist_ip ON lan_allowlist(ip_address) WHERE active=true;

-- DOWN
-- DROP TABLE IF EXISTS lan_allowlist;
