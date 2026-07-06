-- Migration 017: Add status column to sync_runs
-- Tracks whether a run completed fully or was cut short by the 15-min Workers limit.
ALTER TABLE sync_runs ADD COLUMN status TEXT NOT NULL DEFAULT 'running';
-- 'running' → in-progress | 'complete' → finished all programs | 'partial' → timed out, checkpoint saved
ALTER TABLE sync_runs ADD COLUMN total_programs INTEGER DEFAULT 0;
-- Total projects count at time of run start (so UI can show X of Y checked)
