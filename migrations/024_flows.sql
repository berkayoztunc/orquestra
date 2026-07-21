-- Migration 024: Orquestra Flow Engine (OFE) registry — MVP subset
--
-- See docs/flow-engine-design.md for the full design. This migration only
-- creates the tables needed for the first buildable increment (catalog +
-- content-addressed versions + run records + per-protocol fact sheets).
-- flow_payments / flow_health / node_types / flow_dependencies are deferred
-- until the payment plane and self-healing catalog phases actually land —
-- additive migrations only, no schema ahead of need.
--
-- 1. flows: one row per published intent/instruction flow (slug is the
--    stable catalog identity; content-addressed versions live separately).
-- 2. flow_versions: append-only, content-hashed FDL documents + compiled
--    plans. A flow's `stable_version_hash` points at the version currently
--    served for its `@stable` alias.
-- 3. flow_runs: one row per hot-lane execution (estimate or, later, paid
--    execute), for latency/error observability — batched writes, no live
--    read path depends on this table yet.
-- 4. protocol_descriptors: small machine-readable fact sheets per protocol
--    (canonical addresses, non-IDL-derivable semantics) that resolve.constant
--    reads at execution time.

CREATE TABLE IF NOT EXISTS flows (
  id                  TEXT PRIMARY KEY,
  slug                TEXT UNIQUE NOT NULL,
  owner_user_id       TEXT,
  intent              TEXT NOT NULL,
  protocol            TEXT,
  tier                TEXT NOT NULL DEFAULT 'instruction' CHECK (tier IN ('instruction', 'intent', 'composed')),
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'simulated', 'canary', 'published', 'stale', 'deprecated', 'archived')),
  stable_version_hash TEXT,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS flow_versions (
  content_hash    TEXT PRIMARY KEY,
  flow_id         TEXT NOT NULL REFERENCES flows(id),
  version         INTEGER NOT NULL,
  fdl_json        TEXT NOT NULL,
  plan_json       TEXT,
  metadata_json   TEXT NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (flow_id, version)
);

CREATE TABLE IF NOT EXISTS flow_runs (
  id              TEXT PRIMARY KEY,
  version_hash    TEXT NOT NULL REFERENCES flow_versions(content_hash),
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

CREATE TABLE IF NOT EXISTS protocol_descriptors (
  protocol        TEXT NOT NULL,
  version         INTEGER NOT NULL,
  descriptor_json TEXT NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (protocol, version)
);

CREATE INDEX IF NOT EXISTS idx_flows_status ON flows(status);
CREATE INDEX IF NOT EXISTS idx_flow_versions_flow_id ON flow_versions(flow_id);
CREATE INDEX IF NOT EXISTS idx_flow_runs_version_hash ON flow_runs(version_hash);
CREATE INDEX IF NOT EXISTS idx_flow_runs_created_at ON flow_runs(created_at);
