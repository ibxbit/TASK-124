CREATE TABLE IF NOT EXISTS reviews (
  id                  SERIAL PRIMARY KEY,
  order_line_item_id  VARCHAR(64)  NOT NULL UNIQUE,
  order_id            VARCHAR(64)  NOT NULL,
  reviewer_id         VARCHAR(64)  NOT NULL,
  device_id           VARCHAR(128) NOT NULL,
  rating              SMALLINT     NOT NULL CHECK (rating BETWEEN 1 AND 5),
  tags                TEXT[]       NOT NULL DEFAULT '{}'
                      CHECK (array_length(tags, 1) IS NULL OR array_length(tags, 1) <= 5),
  body                VARCHAR(1000),
  anonymous           BOOLEAN      NOT NULL DEFAULT FALSE,
  status              VARCHAR(16)  NOT NULL DEFAULT 'visible'
                      CHECK (status IN ('visible','hidden')),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_device ON reviews(device_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_order  ON reviews(order_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);

CREATE TABLE IF NOT EXISTS review_appeals (
  id          SERIAL PRIMARY KEY,
  review_id   INTEGER     NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  reason      TEXT        NOT NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','upheld','overturned')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_review_appeals_review ON review_appeals(review_id);

CREATE TABLE IF NOT EXISTS review_decisions (
  id           BIGSERIAL PRIMARY KEY,
  review_id    INTEGER      NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  moderator_id INTEGER      NOT NULL REFERENCES users(id),
  decision     VARCHAR(32)  NOT NULL
               CHECK (decision IN ('hide','restore','appeal_upheld','appeal_overturned')),
  reason       TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_decisions_review ON review_decisions(review_id);

CREATE OR REPLACE FUNCTION review_decisions_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'review_decisions is append-only'; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_review_decisions_no_update ON review_decisions;
CREATE TRIGGER trg_review_decisions_no_update
  BEFORE UPDATE OR DELETE ON review_decisions
  FOR EACH ROW EXECUTE FUNCTION review_decisions_immutable();

CREATE TABLE IF NOT EXISTS review_anomalies (
  id          BIGSERIAL PRIMARY KEY,
  review_id   INTEGER     NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  type        VARCHAR(32) NOT NULL CHECK (type IN ('burst','rating_outlier')),
  details     JSONB       NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_anomalies_review ON review_anomalies(review_id);
CREATE INDEX IF NOT EXISTS idx_review_anomalies_type   ON review_anomalies(type);

-- DOWN
-- DROP TABLE IF EXISTS review_anomalies;
-- DROP TRIGGER IF EXISTS trg_review_decisions_no_update ON review_decisions;
-- DROP FUNCTION IF EXISTS review_decisions_immutable();
-- DROP TABLE IF EXISTS review_decisions;
-- DROP TABLE IF EXISTS review_appeals;
-- DROP TABLE IF EXISTS reviews;
