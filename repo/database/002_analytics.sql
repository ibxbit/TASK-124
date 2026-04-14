-- Fact table for analytics + saved queries + async export jobs
CREATE TABLE IF NOT EXISTS transactions (
  id                BIGSERIAL PRIMARY KEY,
  occurred_at       TIMESTAMPTZ NOT NULL,
  provider          VARCHAR(64)  NOT NULL,
  sku               VARCHAR(64)  NOT NULL,
  experiment_bucket VARCHAR(32),
  amount            NUMERIC(14,2) NOT NULL,
  currency          VARCHAR(8)   NOT NULL DEFAULT 'USD',
  refund_reason     VARCHAR(64),
  order_id          VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_tx_occurred_at ON transactions(occurred_at);
CREATE INDEX IF NOT EXISTS idx_tx_provider    ON transactions(provider);
CREATE INDEX IF NOT EXISTS idx_tx_sku         ON transactions(sku);
CREATE INDEX IF NOT EXISTS idx_tx_bucket      ON transactions(experiment_bucket);
CREATE INDEX IF NOT EXISTS idx_tx_refund      ON transactions(refund_reason);

CREATE TABLE IF NOT EXISTS saved_queries (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER      NOT NULL REFERENCES users(id),
  name       VARCHAR(128) NOT NULL,
  definition JSONB        NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS export_jobs (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER     NOT NULL REFERENCES users(id),
  format       VARCHAR(8)  NOT NULL CHECK (format IN ('csv','xlsx')),
  definition   JSONB       NOT NULL,
  status       VARCHAR(16) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','running','completed','failed')),
  row_count    INTEGER,
  file_path    VARCHAR(512),
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_user ON export_jobs(user_id);

-- DOWN
-- DROP TABLE IF EXISTS export_jobs;
-- DROP TABLE IF EXISTS saved_queries;
-- DROP TABLE IF EXISTS transactions;
