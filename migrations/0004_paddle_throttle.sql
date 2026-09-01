-- Per-IP paddle creation throttle. One row per request; the worker counts
-- rows per IP inside a sliding one-hour window and rejects floods with 429.
-- Old rows are pruned opportunistically by the worker.
CREATE TABLE paddle_requests (
  ip TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_paddle_requests_ip_time ON paddle_requests (ip, created_at);
