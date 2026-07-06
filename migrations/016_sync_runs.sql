-- Migration 016: IDL sync run tracking
-- Records every scheduled or manually-triggered IDL sync run,
-- enabling the Sync Dashboard UI to show last-run stats.

CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  total_checked INTEGER DEFAULT 0,
  updated_count INTEGER DEFAULT 0,
  unchanged_count INTEGER DEFAULT 0,
  skipped_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  trigger TEXT NOT NULL DEFAULT 'cron' -- 'cron' | 'manual'
);

CREATE INDEX idx_sync_runs_started_at ON sync_runs(started_at DESC);
