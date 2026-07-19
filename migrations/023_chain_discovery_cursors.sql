-- Migration 023: Incremental chain discovery + IDL resync cursors
--
-- 1. discovery_cursors: tracks getSignaturesForAddress progress per loader
--    address for ChainDiscoveryWorkflow, replacing the daily full
--    getProgramAccounts sweep (daily-scan.yml / cli:scan / cli:queue).
-- 2. project_idl_cursors: tracks getSignaturesForAddress progress per
--    project's derived IDL account(s), letting IdlSyncWorkflow skip the
--    expensive fetchIdlWithSource() call when nothing changed on-chain.

CREATE TABLE IF NOT EXISTS discovery_cursors (
  loader_address TEXT PRIMARY KEY,
  last_signature TEXT,
  last_slot      INTEGER,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_idl_cursors (
  project_id     TEXT PRIMARY KEY REFERENCES projects(id),
  last_signature TEXT,
  checked_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_project_idl_cursors_checked
  ON project_idl_cursors(checked_at);
