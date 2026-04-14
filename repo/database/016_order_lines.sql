-- Authoritative order line records. Reviews must reference a valid entry.
CREATE TABLE IF NOT EXISTS order_line_items (
  id         VARCHAR(64) PRIMARY KEY,
  order_id   VARCHAR(64) NOT NULL,
  sku        VARCHAR(64),
  quantity   INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_line_items(order_id);

-- DOWN
-- DROP TABLE IF EXISTS order_line_items;
