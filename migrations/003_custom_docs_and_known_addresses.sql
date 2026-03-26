-- Add custom documentation support (owner-editable docs)
IF NOT EXISTS (SELECT 1 FROM pragma_table_info('projects') WHERE name = 'custom_docs') THEN
  ALTER TABLE projects ADD COLUMN custom_docs TEXT;
END IF;

-- Known public key addresses for a project
CREATE TABLE IF NOT EXISTS known_addresses (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  label TEXT NOT NULL,
  address TEXT NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_known_addresses_project_id ON known_addresses(project_id);
