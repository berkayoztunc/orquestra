-- Migration 020: Program activity metrics from Solana Compass
-- Imported weekly (Monday 3am UTC via cron '0 3 * * 1').
-- Higher tx_count_7d = more active/legitimate program over the last 7 days.

CREATE TABLE IF NOT EXISTS program_metrics (
  program_id       TEXT PRIMARY KEY,
  tx_count_7d      INTEGER NOT NULL DEFAULT 0,
  unique_users_7d  INTEGER NOT NULL DEFAULT 0,
  fees_sol_7d      REAL    NOT NULL DEFAULT 0,
  compute_units_7d INTEGER NOT NULL DEFAULT 0,
  compass_name     TEXT,
  compass_labels   TEXT,   -- JSON array string e.g. '["amm","dex"]'
  fetched_at       DATETIME NOT NULL,
  updated_at       DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_program_metrics_tx_count
  ON program_metrics(tx_count_7d DESC);
