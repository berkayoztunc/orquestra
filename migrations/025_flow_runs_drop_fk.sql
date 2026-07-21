-- Migration 025: drop the FK on flow_runs.version_hash
--
-- Bug: flow_runs.version_hash REFERENCES flow_versions(content_hash) (migration
-- 024), and D1 enforces foreign keys (confirmed directly: an insert with a
-- version_hash not present in flow_versions fails with SQLITE_CONSTRAINT_FOREIGNKEY
-- — unlike vanilla SQLite, which leaves FK enforcement off by default).
--
-- This breaks the `simulate_flow` MCP tool (routes/flow-mcp.ts) by design: it
-- records a run for a compiled-but-not-yet-published FDL document (that's the
-- entire point — test before publish), so its content hash has no
-- corresponding flow_versions row. Every such write threw and was silently
-- swallowed (services/flow-runs.ts's caller catches and logs), so run
-- observability for the authoring/testing loop was completely dead.
--
-- Fix: content-hash is already the identity primitive used everywhere else in
-- this engine regardless of publish state (plans are cached by hash the same
-- way whether published or not) — requiring a flow_runs row's version_hash to
-- already exist in flow_versions was the actual design error, not something
-- worth working around at the call site. Drop the FK. No production data
-- exists in this table (never deployed — flow_runs.md's own migration was
-- only ever applied to local dev), so a plain drop + recreate is safe here;
-- this is not the pattern to follow once real rows exist.

DROP TABLE IF EXISTS flow_runs;

CREATE TABLE IF NOT EXISTS flow_runs (
  id              TEXT PRIMARY KEY,
  version_hash    TEXT NOT NULL,
  lane            TEXT NOT NULL DEFAULT 'hot' CHECK (lane IN ('hot', 'durable')),
  status          TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  inputs_hash     TEXT,
  outputs_json    TEXT,
  error_json      TEXT,
  latency_ms      INTEGER,
  rpc_calls       INTEGER,
  external_calls  INTEGER,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_flow_runs_version_hash ON flow_runs(version_hash);
CREATE INDEX IF NOT EXISTS idx_flow_runs_created_at ON flow_runs(created_at);
