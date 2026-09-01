-- Settlement verification: track on-chain payment state per settled lot.
-- A settle POST records the winner's claimed tx hash as `settled` with
-- verification pending; a scheduled pass checks it against a public Nimiq
-- JSON-RPC node and marks it `verified` or `rejected`.
ALTER TABLE lots ADD COLUMN settle_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lots ADD COLUMN settle_checked_at INTEGER;
ALTER TABLE lots ADD COLUMN settle_failure TEXT;
