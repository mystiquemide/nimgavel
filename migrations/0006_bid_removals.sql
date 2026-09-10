CREATE TABLE bid_removals (
  lot_id TEXT NOT NULL,
  bid_id TEXT NOT NULL,
  paddle INTEGER NOT NULL,
  amount_lunas INTEGER NOT NULL,
  bid_created_at INTEGER NOT NULL,
  removed_at INTEGER NOT NULL,
  removed_by TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('bidder', 'host')),
  reason TEXT NOT NULL,
  PRIMARY KEY (lot_id, bid_id)
);

CREATE UNIQUE INDEX idx_bid_removals_lookup
  ON bid_removals (lot_id, paddle, amount_lunas, bid_created_at);
