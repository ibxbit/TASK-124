CREATE TABLE IF NOT EXISTS refunds (
  id           SERIAL PRIMARY KEY,
  payment_id   INTEGER       NOT NULL REFERENCES payments(id),
  provider     VARCHAR(32)   NOT NULL,
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reason       TEXT,
  status       VARCHAR(24)   NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','pending_review','approved','rejected','executed')),
  risk_flags   JSONB         NOT NULL DEFAULT '[]'::jsonb,
  created_by   INTEGER       NOT NULL REFERENCES users(id),
  reviewed_by  INTEGER       REFERENCES users(id),
  executed_by  INTEGER       REFERENCES users(id),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  reviewed_at  TIMESTAMPTZ,
  executed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_refunds_payment  ON refunds(payment_id);
CREATE INDEX IF NOT EXISTS idx_refunds_provider ON refunds(provider, created_at);
CREATE INDEX IF NOT EXISTS idx_refunds_status   ON refunds(status);

CREATE TABLE IF NOT EXISTS refund_audit (
  id         BIGSERIAL PRIMARY KEY,
  refund_id  INTEGER     NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
  action     VARCHAR(16) NOT NULL CHECK (action IN
              ('create','edit','approve','reject','execute')),
  actor_id   INTEGER     NOT NULL REFERENCES users(id),
  details    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refund_audit_refund ON refund_audit(refund_id);

CREATE OR REPLACE FUNCTION refund_audit_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'refund_audit is append-only'; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_refund_audit_no_update ON refund_audit;
CREATE TRIGGER trg_refund_audit_no_update
  BEFORE UPDATE OR DELETE ON refund_audit
  FOR EACH ROW EXECUTE FUNCTION refund_audit_immutable();

CREATE TABLE IF NOT EXISTS risk_rules (
  key        VARCHAR(64)   PRIMARY KEY,
  value      NUMERIC(14,4) NOT NULL,
  updated_by INTEGER       REFERENCES users(id),
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

INSERT INTO risk_rules (key, value) VALUES
  ('max_refunds_per_day_per_provider', 3),
  ('max_refund_rate_7d',               0.15)
ON CONFLICT (key) DO NOTHING;

-- DOWN
-- DROP TABLE IF EXISTS risk_rules;
-- DROP TRIGGER IF EXISTS trg_refund_audit_no_update ON refund_audit;
-- DROP FUNCTION IF EXISTS refund_audit_immutable();
-- DROP TABLE IF EXISTS refund_audit;
-- DROP TABLE IF EXISTS refunds;
