CREATE TABLE IF NOT EXISTS imported_files (
  id            SERIAL PRIMARY KEY,
  source        VARCHAR(32)  NOT NULL CHECK (source IN ('wechat_pay','bank')),
  format        VARCHAR(8)   NOT NULL CHECK (format IN ('csv','xlsx')),
  filename      VARCHAR(256) NOT NULL,
  rows_total    INTEGER      NOT NULL DEFAULT 0,
  rows_imported INTEGER      NOT NULL DEFAULT 0,
  imported_by   INTEGER      REFERENCES users(id),
  imported_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id               SERIAL PRIMARY KEY,
  external_id      VARCHAR(128) NOT NULL UNIQUE,
  provider         VARCHAR(32)  NOT NULL,
  merchant_id      VARCHAR(64)  NOT NULL,
  order_id         VARCHAR(64)  NOT NULL,
  state            VARCHAR(16)  NOT NULL DEFAULT 'pre_auth'
                   CHECK (state IN ('pre_auth','deposit','full')),
  gross_amount     NUMERIC(14,2) NOT NULL,
  currency         VARCHAR(8)   NOT NULL DEFAULT 'CNY',
  occurred_at      TIMESTAMPTZ  NOT NULL,
  imported_file_id INTEGER      REFERENCES imported_files(id),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_occurred ON payments(occurred_at);
CREATE INDEX IF NOT EXISTS idx_payments_merchant ON payments(merchant_id);

CREATE TABLE IF NOT EXISTS payment_transitions (
  id          BIGSERIAL PRIMARY KEY,
  payment_id  INTEGER     NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  from_state  VARCHAR(16),
  to_state    VARCHAR(16) NOT NULL,
  actor_id    INTEGER     REFERENCES users(id),
  reason      TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupons (
  id         SERIAL PRIMARY KEY,
  code       VARCHAR(64) NOT NULL UNIQUE,
  kind       VARCHAR(16) NOT NULL CHECK (kind IN ('fixed','percent')),
  value      NUMERIC(14,4) NOT NULL CHECK (value >= 0),
  active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupon_allocations (
  id         SERIAL PRIMARY KEY,
  payment_id INTEGER       NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  coupon_id  INTEGER       NOT NULL REFERENCES coupons(id),
  amount     NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coupon_alloc_payment ON coupon_allocations(payment_id);

CREATE TABLE IF NOT EXISTS payment_fees (
  id          BIGSERIAL PRIMARY KEY,
  payment_id  INTEGER       NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  fee_type    VARCHAR(32)   NOT NULL CHECK (fee_type IN
               ('service','platform','surcharge','sales_tax','commission')),
  amount      NUMERIC(14,2) NOT NULL,
  description VARCHAR(128)
);
CREATE INDEX IF NOT EXISTS idx_fees_payment ON payment_fees(payment_id);

CREATE TABLE IF NOT EXISTS commission_rates (
  id         SERIAL PRIMARY KEY,
  provider   VARCHAR(32)   UNIQUE,
  rate       NUMERIC(6,5)  NOT NULL CHECK (rate >= 0 AND rate <= 1),
  updated_by INTEGER       REFERENCES users(id),
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

INSERT INTO commission_rates (provider, rate) VALUES (NULL, 0.12500)
  ON CONFLICT (provider) DO NOTHING;

CREATE TABLE IF NOT EXISTS ledger_entries (
  id          BIGSERIAL PRIMARY KEY,
  payment_id  INTEGER       REFERENCES payments(id) ON DELETE SET NULL,
  account     VARCHAR(64)   NOT NULL,
  debit       NUMERIC(14,2) NOT NULL DEFAULT 0,
  credit      NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency    VARCHAR(8)    NOT NULL DEFAULT 'CNY',
  occurred_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  memo        VARCHAR(256),
  CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0))
);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entries(account);
CREATE INDEX IF NOT EXISTS idx_ledger_payment ON ledger_entries(payment_id);

CREATE OR REPLACE FUNCTION ledger_entries_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'ledger_entries is append-only'; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_no_update ON ledger_entries;
CREATE TRIGGER trg_ledger_no_update
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();

CREATE TABLE IF NOT EXISTS settlement_cycles (
  id           SERIAL PRIMARY KEY,
  period_start TIMESTAMPTZ  NOT NULL,
  period_end   TIMESTAMPTZ  NOT NULL,
  status       VARCHAR(16)  NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','running','completed','failed')),
  total_gross  NUMERIC(14,2) DEFAULT 0,
  total_fees   NUMERIC(14,2) DEFAULT 0,
  total_net    NUMERIC(14,2) DEFAULT 0,
  run_by       INTEGER      REFERENCES users(id),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (period_start, period_end)
);

CREATE TABLE IF NOT EXISTS settlement_lines (
  id          BIGSERIAL PRIMARY KEY,
  cycle_id    INTEGER       NOT NULL REFERENCES settlement_cycles(id) ON DELETE CASCADE,
  merchant_id VARCHAR(64)   NOT NULL,
  gross       NUMERIC(14,2) NOT NULL,
  fees        NUMERIC(14,2) NOT NULL,
  net         NUMERIC(14,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_settlement_lines_cycle ON settlement_lines(cycle_id);

-- DOWN
-- DROP TABLE IF EXISTS settlement_lines;
-- DROP TABLE IF EXISTS settlement_cycles;
-- DROP TRIGGER IF EXISTS trg_ledger_no_update ON ledger_entries;
-- DROP FUNCTION IF EXISTS ledger_entries_immutable();
-- DROP TABLE IF EXISTS ledger_entries;
-- DROP TABLE IF EXISTS commission_rates;
-- DROP TABLE IF EXISTS payment_fees;
-- DROP TABLE IF EXISTS coupon_allocations;
-- DROP TABLE IF EXISTS coupons;
-- DROP TABLE IF EXISTS payment_transitions;
-- DROP TABLE IF EXISTS payments;
-- DROP TABLE IF EXISTS imported_files;
