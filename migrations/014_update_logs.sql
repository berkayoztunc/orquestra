-- Track on-chain IDL updates detected by the daily cron sync
CREATE TABLE IF NOT EXISTS update_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  program_id TEXT NOT NULL,
  program_name TEXT,
  old_version INTEGER,
  new_version INTEGER NOT NULL,
  old_hash TEXT,
  new_hash TEXT NOT NULL,
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_update_logs_project_id ON update_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_update_logs_detected_at ON update_logs(detected_at);
