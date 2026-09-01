-- One-time wallet challenges used to authorize lot creation.

CREATE TABLE IF NOT EXISTS host_challenges (
  id TEXT PRIMARY KEY,
  host_address TEXT NOT NULL,
  message TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_host_challenges_expiry
  ON host_challenges(expires_at, used_at);

