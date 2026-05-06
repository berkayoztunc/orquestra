-- Migration 011: Program Lists & Scope Keys
-- Allows users to create named collections of programs and generate scope keys
-- for scoped MCP search (X-Scope-Key header)

CREATE TABLE IF NOT EXISTS program_lists (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  is_default  INTEGER NOT NULL DEFAULT 0,  -- 1 for the auto-created "Default" list
  scope_key   TEXT UNIQUE NOT NULL,         -- "sk_" + 64 hex chars
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS program_list_items (
  id         TEXT PRIMARY KEY,
  list_id    TEXT NOT NULL REFERENCES program_lists(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  added_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(list_id, project_id)
);

-- Fast lookup by scope key (MCP hot path)
CREATE INDEX IF NOT EXISTS idx_program_lists_scope_key ON program_lists(scope_key);
-- User's list lookup
CREATE INDEX IF NOT EXISTS idx_program_lists_user_id ON program_lists(user_id);
-- Items by list
CREATE INDEX IF NOT EXISTS idx_program_list_items_list_id ON program_list_items(list_id);
-- Items by project (check membership)
CREATE INDEX IF NOT EXISTS idx_program_list_items_project_id ON program_list_items(project_id);
