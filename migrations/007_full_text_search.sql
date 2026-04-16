-- Full-Text Search with Relevance Scoring
-- Solves the problem of AI making multiple search attempts with different names

-- Program categories for semantic search
CREATE TABLE IF NOT EXISTS program_categories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT, -- comma-separated tags like "dex,swap,amm"
  aliases TEXT, -- comma-separated aliases like "pump,pumpfun"
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(project_id)
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS projects_fts USING fts5(
  name,
  description,
  category,
  tags,
  aliases,
  content = 'projects',
  content_rowid = 'id'
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS projects_ai AFTER INSERT ON projects BEGIN
  INSERT INTO projects_fts(rowid, name, description)
  VALUES (NEW.id, NEW.name, COALESCE(NEW.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS projects_ad AFTER DELETE ON projects BEGIN
  DELETE FROM projects_fts WHERE rowid = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS projects_au AFTER UPDATE ON projects BEGIN
  UPDATE projects_fts SET name = NEW.name, description = COALESCE(NEW.description, '')
  WHERE rowid = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS categories_ai AFTER INSERT ON program_categories BEGIN
  UPDATE projects_fts 
  SET category = NEW.category, tags = COALESCE(NEW.tags, ''), aliases = COALESCE(NEW.aliases, '')
  WHERE rowid = NEW.project_id;
END;

CREATE TRIGGER IF NOT EXISTS categories_au AFTER UPDATE ON program_categories BEGIN
  UPDATE projects_fts 
  SET category = NEW.category, tags = COALESCE(NEW.tags, ''), aliases = COALESCE(NEW.aliases, '')
  WHERE rowid = NEW.project_id;
END;

-- Index for performance
CREATE INDEX IF NOT EXISTS program_categories_project_id ON program_categories(project_id);
