-- Migration 018: Program discovery queue
-- Stores program IDs to be checked by the cron for on-chain IDLs.
-- Programs with a valid IDL are auto-imported; those without are marked no_idl
-- and never imported. This lets the cron own the full discover→verify→import
-- pipeline without needing a manual check-idl CLI run with --enable-ingest.
--
-- Workflow:
--   1. CLI `queue` command reads programs.csv → POST /api/ingest/candidates
--   2. Cron Phase 2 reads 'pending' rows, calls fetchIdlWithSource per program
--   3. IDL found  → auto-creates project + idl_versions → status = 'has_idl'
--      No IDL      → status = 'no_idl' (never imported, never checked again)

CREATE TABLE IF NOT EXISTS program_candidates (
  program_id      TEXT PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'pending',
  -- 'pending'  : queued, not yet checked
  -- 'has_idl'  : verified on-chain IDL exists; project imported (or already existed)
  -- 'no_idl'   : checked, no on-chain IDL — will not be imported
  added_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at DATETIME,
  source          TEXT NOT NULL DEFAULT 'cli'
  -- 'cli'    : added by `bun run cli:queue`
  -- 'api'    : added via POST /api/ingest/candidates
  -- 'manual' : added directly
);

CREATE INDEX idx_program_candidates_status   ON program_candidates(status);
CREATE INDEX idx_program_candidates_added_at ON program_candidates(added_at DESC);

-- Extend sync_runs to track candidate processing per run
ALTER TABLE sync_runs ADD COLUMN candidates_checked  INTEGER DEFAULT 0;
ALTER TABLE sync_runs ADD COLUMN candidates_imported INTEGER DEFAULT 0;
