CREATE TABLE IF NOT EXISTS follows (
  follower_id VARCHAR(64) NOT NULL,
  followee_id VARCHAR(64) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

CREATE TABLE IF NOT EXISTS likes (
  user_id     VARCHAR(64) NOT NULL,
  target_type VARCHAR(32) NOT NULL,
  target_id   BIGINT      NOT NULL,
  kind        VARCHAR(16) NOT NULL DEFAULT 'like' CHECK (kind IN ('like','favorite')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, target_type, target_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_likes_target ON likes(target_type, target_id);

CREATE TABLE IF NOT EXISTS comments (
  id          BIGSERIAL PRIMARY KEY,
  parent_id   BIGINT      REFERENCES comments(id) ON DELETE CASCADE,
  author_id   VARCHAR(64) NOT NULL,
  target_type VARCHAR(32) NOT NULL,
  target_id   BIGINT      NOT NULL,
  body        TEXT        NOT NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'visible'
              CHECK (status IN ('visible','hidden','removed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comments_target      ON comments(target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent      ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_author_time ON comments(author_id, created_at);

CREATE TABLE IF NOT EXISTS comment_mentions (
  comment_id        BIGINT      NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  mentioned_user_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (comment_id, mentioned_user_id)
);

CREATE TABLE IF NOT EXISTS comment_images (
  id         BIGSERIAL PRIMARY KEY,
  comment_id BIGINT       NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  file_path  VARCHAR(512) NOT NULL,
  size_bytes INTEGER      NOT NULL,
  mime_type  VARCHAR(64)  NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comment_images_comment ON comment_images(comment_id);

CREATE TABLE IF NOT EXISTS content_reports (
  id          SERIAL PRIMARY KEY,
  reporter_id VARCHAR(64) NOT NULL,
  target_type VARCHAR(32) NOT NULL,
  target_id   BIGINT      NOT NULL,
  reason      TEXT        NOT NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'open'
              CHECK (status IN ('open','resolved')),
  outcome     VARCHAR(16) CHECK (outcome IN ('remove','warn','no_action')),
  resolved_by INTEGER     REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports(status);
CREATE INDEX IF NOT EXISTS idx_content_reports_target ON content_reports(target_type, target_id);

CREATE TABLE IF NOT EXISTS content_appeals (
  id           SERIAL PRIMARY KEY,
  report_id    INTEGER     NOT NULL REFERENCES content_reports(id) ON DELETE CASCADE,
  appellant_id VARCHAR(64) NOT NULL,
  reason       TEXT        NOT NULL,
  status       VARCHAR(16) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','upheld','overturned')),
  resolved_by  INTEGER     REFERENCES users(id),
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blacklists (
  id         SERIAL PRIMARY KEY,
  kind       VARCHAR(16)  NOT NULL CHECK (kind IN ('word','user')),
  value      VARCHAR(256) NOT NULL,
  added_by   INTEGER      REFERENCES users(id),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (kind, value)
);

CREATE TABLE IF NOT EXISTS throttle_policies (
  key            VARCHAR(64) PRIMARY KEY,
  max_count      INTEGER     NOT NULL,
  window_seconds INTEGER     NOT NULL,
  updated_by     INTEGER     REFERENCES users(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO throttle_policies (key, max_count, window_seconds) VALUES
  ('comments_per_hour', 30, 3600)
ON CONFLICT (key) DO NOTHING;

-- DOWN
-- DROP TABLE IF EXISTS throttle_policies;
-- DROP TABLE IF EXISTS blacklists;
-- DROP TABLE IF EXISTS content_appeals;
-- DROP TABLE IF EXISTS content_reports;
-- DROP TABLE IF EXISTS comment_images;
-- DROP TABLE IF EXISTS comment_mentions;
-- DROP TABLE IF EXISTS comments;
-- DROP TABLE IF EXISTS likes;
-- DROP TABLE IF EXISTS follows;
