CREATE TABLE IF NOT EXISTS checkpoints (
  id            BIGSERIAL PRIMARY KEY,
  kind          VARCHAR(32)  NOT NULL CHECK (kind IN
                 ('settlement','moderation_queue','experiments')),
  key           VARCHAR(128) NOT NULL,
  payload       JSONB        NOT NULL,
  checkpoint_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_lookup ON checkpoints(kind, key, checkpoint_at DESC);

CREATE TABLE IF NOT EXISTS memory_samples (
  id         BIGSERIAL PRIMARY KEY,
  sampled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rss_bytes  BIGINT      NOT NULL,
  heap_used  BIGINT      NOT NULL,
  heap_total BIGINT      NOT NULL,
  external   BIGINT      NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_samples_time ON memory_samples(sampled_at);

CREATE TABLE IF NOT EXISTS startup_events (
  id          BIGSERIAL PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL,
  ready_at    TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER     NOT NULL,
  pid         INTEGER     NOT NULL,
  notes       TEXT
);

-- DOWN
-- DROP TABLE IF EXISTS startup_events;
-- DROP TABLE IF EXISTS memory_samples;
-- DROP TABLE IF EXISTS checkpoints;
