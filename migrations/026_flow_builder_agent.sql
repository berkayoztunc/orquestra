-- Migration 026: Flow Builder Agent — autonomous FDL authoring, audit log, Telegram approval queue.
--
-- The first server-side flow GENERATOR (everything in migration 024/`flow-mcp.ts`
-- only validates/simulates/publishes what a client authors). A daily Workflow
-- (FlowBuilderAgentWorkflow) picks verified programs with no published flow (or
-- a flow it can strictly improve on — fewer inputs, fewer RPC calls), drafts an
-- FDL via Workers AI, compiles + simulates it in-process, and — if it's an
-- improvement — proposes it over Telegram. Approving re-verifies and publishes
-- in one step; rejecting or letting it sit does nothing further.
--
-- 1. flows.program_id: lets the agent join "verified programs" against "flows
--    that already cover them" — `flows` previously had nothing joinable to a
--    program address (only slug/intent/protocol).
-- 2. flow_builder_attempts: one row per attempt, built or not — the audit log
--    (why picked, what optimized, cost) and, filtered by outcome='proposed',
--    the Telegram approval queue itself. No separate queue table.
-- 3. flow_builder_drafts: the AI-authored FDL/plan/raw response, kept off the
--    lightweight attempts table (same reasoning flow_versions already keeps
--    fdl_json/plan_json off the flows catalog row).

ALTER TABLE flows ADD COLUMN program_id TEXT;
CREATE INDEX IF NOT EXISTS idx_flows_program_id ON flows(program_id);

CREATE TABLE IF NOT EXISTS flow_builder_attempts (
  id                    TEXT PRIMARY KEY,
  workflow_instance_id  TEXT,
  program_id            TEXT NOT NULL,
  project_id            TEXT,
  project_name          TEXT,
  reason                TEXT NOT NULL CHECK (reason IN ('no_flow', 'optimization_candidate')),
  reason_detail         TEXT,
  prior_flow_id         TEXT,
  prior_input_count     INTEGER,
  prior_rpc_calls       INTEGER,
  model                 TEXT NOT NULL,
  prompt_tokens         INTEGER,
  completion_tokens     INTEGER,
  neurons_estimated     REAL,
  usd_estimated         REAL,
  attempt_rounds        INTEGER NOT NULL DEFAULT 1,
  fdl_content_hash      TEXT,
  new_input_count       INTEGER,
  new_rpc_calls         INTEGER,
  rationale             TEXT,
  outcome               TEXT NOT NULL CHECK (outcome IN (
                           'compile_failed', 'simulate_failed', 'proposed', 'approved',
                           'rejected', 'published', 'publish_failed', 'skipped_no_improvement'
                         )),
  error_detail          TEXT,
  telegram_message_id   TEXT,
  telegram_chat_id      TEXT,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fba_program_id ON flow_builder_attempts(program_id);
CREATE INDEX IF NOT EXISTS idx_fba_outcome ON flow_builder_attempts(outcome);
CREATE INDEX IF NOT EXISTS idx_fba_created_at ON flow_builder_attempts(created_at);
CREATE INDEX IF NOT EXISTS idx_fba_telegram_message_id ON flow_builder_attempts(telegram_message_id);

CREATE TABLE IF NOT EXISTS flow_builder_drafts (
  attempt_id      TEXT PRIMARY KEY REFERENCES flow_builder_attempts(id),
  fdl_json        TEXT NOT NULL,
  plan_json       TEXT,
  raw_ai_response TEXT,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
