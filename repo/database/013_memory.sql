-- Memory alerts: every time growth crosses a threshold, one row is written.
CREATE TABLE IF NOT EXISTS memory_alerts (
  id         BIGSERIAL PRIMARY KEY,
  severity   VARCHAR(16)  NOT NULL CHECK (severity IN ('warning','critical')),
  growth     NUMERIC(8,6) NOT NULL,         -- fraction, e.g. 0.231000 = 23.1%
  rss_bytes  BIGINT       NOT NULL,
  baseline   BIGINT       NOT NULL,
  scope      VARCHAR(32)  NOT NULL CHECK (scope IN ('since_boot','30d')),
  note       TEXT,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_memory_alerts_time  ON memory_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_alerts_scope ON memory_alerts(scope, created_at DESC);

-- ── Hot-path indexes to speed up heavy queries & background jobs ──────────

-- Risk evaluation: "refunds in last 24h / 7d by provider" runs on every
-- refund creation. A covering index on (provider, created_at) replaces seq scans.
CREATE INDEX IF NOT EXISTS idx_refunds_provider_status_time
  ON refunds(provider, status, created_at);

-- Payments-by-provider windowing for refund-rate risk rule + reconciliation.
CREATE INDEX IF NOT EXISTS idx_payments_provider_time
  ON payments(provider, occurred_at);

-- Fee aggregation joined to payments on (payment_id, fee_type) during
-- settlement + reconciliation.
CREATE INDEX IF NOT EXISTS idx_payment_fees_payment_type
  ON payment_fees(payment_id, fee_type);

-- Checkpoint retention job uses created_at to prune old rows.
CREATE INDEX IF NOT EXISTS idx_checkpoints_age
  ON checkpoints(checkpoint_at);

-- Memory samples: reads are always time-windowed (e.g. "last 30d").
CREATE INDEX IF NOT EXISTS idx_memory_samples_sampled_desc
  ON memory_samples(sampled_at DESC);

-- DOWN
-- DROP INDEX IF EXISTS idx_memory_samples_sampled_desc;
-- DROP INDEX IF EXISTS idx_checkpoints_age;
-- DROP INDEX IF EXISTS idx_payment_fees_payment_type;
-- DROP INDEX IF EXISTS idx_payments_provider_time;
-- DROP INDEX IF EXISTS idx_refunds_provider_status_time;
-- DROP TABLE IF EXISTS memory_alerts;
