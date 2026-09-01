-- Make bid-log persistence idempotent: re-finalizing a room after a crash
-- must not insert duplicate bid rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_lot_paddle_amount_ts
  ON bids (lot_id, paddle, amount_lunas, created_at);
