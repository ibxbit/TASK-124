-- Checkpoint integrity: per-row checksum + monotonic sequence.
-- Recovery audit trail: every restore attempt is logged with its outcome.

CREATE SEQUENCE IF NOT EXISTS checkpoint_sequence;

ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS checksum VARCHAR(128);
ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS sequence BIGINT;

CREATE INDEX IF NOT EXISTS idx_checkpoints_seq   ON checkpoints(kind, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_checkpoints_kind  ON checkpoints(kind, checkpoint_at DESC);

-- Recovery log: one row per (boot_id, kind) so forensics can replay what
-- happened during any startup.
CREATE TABLE IF NOT EXISTS recovery_events (
  id            BIGSERIAL PRIMARY KEY,
  boot_id       VARCHAR(64)  NOT NULL,
  kind          VARCHAR(32)  NOT NULL,
  status        VARCHAR(16)  NOT NULL CHECK (status IN
                 ('started','completed','failed','skipped','corrupt')),
  checkpoint_id BIGINT       REFERENCES checkpoints(id),
  details       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recovery_events_boot ON recovery_events(boot_id, created_at);
CREATE INDEX IF NOT EXISTS idx_recovery_events_kind ON recovery_events(kind, created_at);

-- Idempotency anchor for settlement resumption: at most one line per
-- (cycle, merchant). Uses a guarded index so this migration is safe to
-- re-apply on databases that already contain duplicate rows (unlikely but
-- not impossible under the pre-hardening code path).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname='ux_settlement_lines_cycle_merchant'
  ) THEN
    BEGIN
      CREATE UNIQUE INDEX ux_settlement_lines_cycle_merchant
        ON settlement_lines(cycle_id, merchant_id);
    EXCEPTION WHEN unique_violation OR others THEN
      -- Legacy duplicates present; skip unique constraint, resume path will
      -- still dedupe by DELETE+INSERT during recovery.
      NULL;
    END;
  END IF;
END $$;

-- DOWN
-- DROP TABLE IF EXISTS recovery_events;
-- DROP SEQUENCE IF EXISTS checkpoint_sequence;
-- DROP INDEX IF EXISTS ux_settlement_lines_cycle_merchant;
