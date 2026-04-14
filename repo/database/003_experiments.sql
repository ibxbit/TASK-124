CREATE TABLE IF NOT EXISTS experiments (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(128) NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS experiment_versions (
  id            SERIAL PRIMARY KEY,
  experiment_id INTEGER     NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  version       INTEGER     NOT NULL,
  start_ts      TIMESTAMPTZ NOT NULL,
  end_ts        TIMESTAMPTZ NOT NULL,
  traffic_split JSONB       NOT NULL,
  created_by    INTEGER     REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (experiment_id, version),
  CHECK (end_ts > start_ts)
);

CREATE INDEX IF NOT EXISTS idx_exp_versions_window
  ON experiment_versions(experiment_id, start_ts, end_ts);

CREATE TABLE IF NOT EXISTS experiment_events (
  id            BIGSERIAL PRIMARY KEY,
  experiment_id INTEGER     NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  version       INTEGER     NOT NULL,
  user_id       VARCHAR(64) NOT NULL,
  bucket        VARCHAR(32) NOT NULL,
  event_type    VARCHAR(16) NOT NULL
                CHECK (event_type IN ('impression','click','conversion')),
  item_id       VARCHAR(64),
  occurred_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exp_events_lookup
  ON experiment_events(experiment_id, version, bucket, event_type);
CREATE INDEX IF NOT EXISTS idx_exp_events_user
  ON experiment_events(user_id, occurred_at);

CREATE TABLE IF NOT EXISTS recommendation_runs (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recommendation_items (
  run_id   INTEGER     NOT NULL REFERENCES recommendation_runs(id) ON DELETE CASCADE,
  user_id  VARCHAR(64) NOT NULL,
  rank     INTEGER     NOT NULL,
  item_id  VARCHAR(64) NOT NULL,
  category VARCHAR(64),
  PRIMARY KEY (run_id, user_id, rank)
);

CREATE TABLE IF NOT EXISTS recommendation_ground_truth (
  run_id  INTEGER     NOT NULL REFERENCES recommendation_runs(id) ON DELETE CASCADE,
  user_id VARCHAR(64) NOT NULL,
  item_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (run_id, user_id, item_id)
);

CREATE TABLE IF NOT EXISTS catalog_items (
  item_id  VARCHAR(64) PRIMARY KEY,
  category VARCHAR(64)
);

-- DOWN
-- DROP TABLE IF EXISTS catalog_items;
-- DROP TABLE IF EXISTS recommendation_ground_truth;
-- DROP TABLE IF EXISTS recommendation_items;
-- DROP TABLE IF EXISTS recommendation_runs;
-- DROP TABLE IF EXISTS experiment_events;
-- DROP TABLE IF EXISTS experiment_versions;
-- DROP TABLE IF EXISTS experiments;
