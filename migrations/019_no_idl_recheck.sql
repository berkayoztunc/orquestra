-- Migration 019: no_idl recheck window + scan metadata KV key
--
-- Programs marked 'no_idl' are now given a recheck_after timestamp (default +30 days).
-- The cron picks them back up when that window expires, allowing programs that
-- ship IDLs post-deployment to eventually be discovered and auto-imported.
--
-- No new tables: scan metadata is stored in the CACHE KV namespace under the key
-- 'scan:metadata' — no D1 table needed for this single-key value.

-- Add recheck_after column to program_candidates
ALTER TABLE program_candidates ADD COLUMN recheck_after DATETIME;

CREATE INDEX IF NOT EXISTS idx_program_candidates_recheck
  ON program_candidates(status, recheck_after)
  WHERE status = 'no_idl';

-- Backfill existing no_idl rows with a recheck window (spread over next 30 days
-- to avoid a thundering herd on first run after migration)
UPDATE program_candidates
SET recheck_after = datetime('now', '+' || (abs(random()) % 30 + 1) || ' days')
WHERE status = 'no_idl' AND recheck_after IS NULL;
