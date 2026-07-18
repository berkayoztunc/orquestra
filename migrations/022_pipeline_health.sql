-- Migration 022: Pipeline durability + health tracking
--
-- 1. Dead-letter support on program_candidates: failed fetches now increment
--    `attempts` and record `last_error`; after 5 attempts a candidate moves to
--    status 'failed' (dead-letter) instead of being retried forever.
--    New status value:
--      'failed' : gave up after repeated errors — excluded from selection,
--                 visible via admin dead-letter queries.
-- 2. workflow_instances: local registry of every Workflow instance we create
--    (scheduled handler, admin triggers, workflow self-continuations). The
--    pipeline health checker polls instance statuses via workflow bindings
--    using these IDs — no Cloudflare REST API calls needed.

ALTER TABLE program_candidates ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE program_candidates ADD COLUMN last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_program_candidates_status_attempts
  ON program_candidates(status, attempts);

CREATE TABLE IF NOT EXISTS workflow_instances (
  instance_id TEXT PRIMARY KEY,
  workflow    TEXT NOT NULL,          -- binding-level name, e.g. 'candidates-drain'
  trigger     TEXT,                   -- 'cron' | 'schedule' | 'admin' | 'continuation' | 'remediation'
  params_json TEXT,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_status TEXT,                   -- last polled status ('running', 'complete', 'errored', ...)
  checked_at  DATETIME                -- when last_status was last polled
);

CREATE INDEX IF NOT EXISTS idx_workflow_instances_created
  ON workflow_instances(workflow, created_at DESC);
