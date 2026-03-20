-- Add idl_hash column to idl_versions for duplicate detection in CLI ingest
ALTER TABLE idl_versions ADD COLUMN idl_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_idl_versions_project_hash ON idl_versions(project_id, idl_hash);

-- AI-generated analyses for discovered IDL programs
CREATE TABLE IF NOT EXISTS ai_analyses (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  idl_version_id TEXT,
  short_description TEXT,
  detailed_analysis_json TEXT,
  model_used TEXT,
  generated_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (idl_version_id) REFERENCES idl_versions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_analyses_project_id ON ai_analyses(project_id);
CREATE INDEX IF NOT EXISTS idx_ai_analyses_idl_version_id ON ai_analyses(idl_version_id);
CREATE INDEX IF NOT EXISTS idx_ai_analyses_generated_at ON ai_analyses(generated_at);
