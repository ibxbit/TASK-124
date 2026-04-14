CREATE TABLE IF NOT EXISTS sensitive_credentials (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  label       VARCHAR(64)  NOT NULL,
  ciphertext  BYTEA        NOT NULL,
  last4       VARCHAR(4)   NOT NULL,
  key_version SMALLINT     NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, label)
);

CREATE TABLE IF NOT EXISTS financial_tokens (
  id          SERIAL PRIMARY KEY,
  owner_type  VARCHAR(32)  NOT NULL,
  owner_id    VARCHAR(64)  NOT NULL,
  token_type  VARCHAR(32)  NOT NULL,
  ciphertext  BYTEA        NOT NULL,
  last4       VARCHAR(4)   NOT NULL,
  key_version SMALLINT     NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fin_tokens_owner ON financial_tokens(owner_type, owner_id);

-- DOWN
-- DROP TABLE IF EXISTS financial_tokens;
-- DROP TABLE IF EXISTS sensitive_credentials;
