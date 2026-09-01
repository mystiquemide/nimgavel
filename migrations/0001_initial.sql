-- Nimgavel D1 schema

CREATE TABLE IF NOT EXISTS lots (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  host_paddle INTEGER NOT NULL,
  host_address TEXT NOT NULL,
  start_price_lunas INTEGER NOT NULL,
  min_increment_lunas INTEGER NOT NULL DEFAULT 100000,
  duration_sec INTEGER NOT NULL DEFAULT 180,
  status TEXT NOT NULL DEFAULT 'created',
  scheduled_at INTEGER,
  started_at INTEGER,
  ended_at INTEGER,
  winning_paddle INTEGER,
  winning_bid_lunas INTEGER,
  tx_hash TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lots_status ON lots(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_lots_host ON lots(host_paddle);

CREATE TABLE IF NOT EXISTS bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id TEXT NOT NULL,
  paddle INTEGER NOT NULL,
  amount_lunas INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bids_lot ON bids(lot_id, id);

CREATE TABLE IF NOT EXISTS paddles (
  paddle INTEGER PRIMARY KEY,
  device_hash TEXT NOT NULL UNIQUE,
  alias TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
