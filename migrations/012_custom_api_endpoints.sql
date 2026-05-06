-- Owner-documented external API/indexer endpoints for a project.
-- Orquestra stores these as documentation only; it does not execute or proxy them.
CREATE TABLE IF NOT EXISTS custom_api_endpoints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  purpose TEXT NOT NULL,
  parameters_json TEXT,
  example_request TEXT,
  response_notes TEXT,
  auth_notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_custom_api_endpoints_project_id ON custom_api_endpoints(project_id);
