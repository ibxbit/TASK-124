-- Sliding-window rate limiter events. One row per actioned event.
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id         BIGSERIAL    PRIMARY KEY,
  bucket_key VARCHAR(128) NOT NULL,           -- e.g. 'user:42:comment'
  at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rate_key_time ON rate_limit_events(bucket_key, at DESC);

-- Per-device activity log for fingerprint abuse tracking.
CREATE TABLE IF NOT EXISTS device_events (
  id         BIGSERIAL    PRIMARY KEY,
  device_id  VARCHAR(128) NOT NULL,
  user_id    VARCHAR(64)  NOT NULL,
  kind       VARCHAR(32)  NOT NULL,           -- 'comment','like','report',...
  signal     VARCHAR(32),                     -- 'duplicate','rate_exceeded','ok',...
  metadata   JSONB        NOT NULL DEFAULT '{}'::jsonb,
  at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_device_events_device ON device_events(device_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_device_events_user   ON device_events(user_id,   at DESC);
CREATE INDEX IF NOT EXISTS idx_device_events_signal ON device_events(signal, at DESC);

-- Normalized-content hashes. Used for duplicate detection.
CREATE TABLE IF NOT EXISTS content_hashes (
  id           BIGSERIAL   PRIMARY KEY,
  user_id      VARCHAR(64) NOT NULL,
  target_type  VARCHAR(32) NOT NULL,
  content_hash VARCHAR(64) NOT NULL,          -- sha256 of normalized body
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_content_hashes_user ON content_hashes(user_id, content_hash, created_at DESC);

-- Per-user running spam score (with decay at read time).
CREATE TABLE IF NOT EXISTS spam_scores (
  user_id    VARCHAR(64)   PRIMARY KEY,
  score      NUMERIC(10,4) NOT NULL DEFAULT 0,
  last_event VARCHAR(64),
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_spam_scores_updated ON spam_scores(updated_at DESC);

-- DOWN
-- DROP TABLE IF EXISTS spam_scores;
-- DROP TABLE IF EXISTS content_hashes;
-- DROP TABLE IF EXISTS device_events;
-- DROP TABLE IF EXISTS rate_limit_events;
