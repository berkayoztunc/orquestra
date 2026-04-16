-- Fix FTS5 table — standalone, no content table
--
-- The 007 migration had two bugs:
--   1. content='projects' causes FTS5 to read category/tags/aliases back from
--      the projects table, which doesn't have those columns → "no such column: T.category"
--   2. content_rowid='id' but projects.id is TEXT, not INTEGER — FTS5 rowid must be integer
--
-- Solution: drop and recreate as a standalone FTS5 table (stores its own copy of the data),
-- keyed by a stored project_id TEXT column instead of rowid.

-- Drop old triggers
DROP TRIGGER IF EXISTS projects_ai;
DROP TRIGGER IF EXISTS projects_ad;
DROP TRIGGER IF EXISTS projects_au;
DROP TRIGGER IF EXISTS categories_ai;
DROP TRIGGER IF EXISTS categories_au;

-- Drop old broken FTS5 table
DROP TABLE IF EXISTS projects_fts;

-- Standalone FTS5 — stores its own data, no backing content table
CREATE VIRTUAL TABLE IF NOT EXISTS projects_fts USING fts5(
  project_id UNINDEXED,
  name,
  description,
  category,
  tags,
  aliases
);

-- Backfill all existing projects (with category data where available)
INSERT INTO projects_fts(project_id, name, description, category, tags, aliases)
SELECT
  p.id,
  p.name,
  COALESCE(p.description, ''),
  COALESCE(pc.category, ''),
  COALESCE(pc.tags, ''),
  COALESCE(pc.aliases, '')
FROM projects p
LEFT JOIN program_categories pc ON pc.project_id = p.id;

-- Trigger: new project inserted
CREATE TRIGGER IF NOT EXISTS projects_ai AFTER INSERT ON projects BEGIN
  INSERT INTO projects_fts(project_id, name, description, category, tags, aliases)
  VALUES (NEW.id, NEW.name, COALESCE(NEW.description, ''), '', '', '');
END;

-- Trigger: project deleted
CREATE TRIGGER IF NOT EXISTS projects_ad AFTER DELETE ON projects BEGIN
  DELETE FROM projects_fts WHERE project_id = OLD.id;
END;

-- Trigger: project updated (DELETE + INSERT to refresh)
CREATE TRIGGER IF NOT EXISTS projects_au AFTER UPDATE ON projects BEGIN
  DELETE FROM projects_fts WHERE project_id = OLD.id;
  INSERT INTO projects_fts(project_id, name, description, category, tags, aliases)
  SELECT NEW.id, NEW.name, COALESCE(NEW.description, ''),
         COALESCE(pc.category, ''), COALESCE(pc.tags, ''), COALESCE(pc.aliases, '')
  FROM (SELECT NULL) t
  LEFT JOIN program_categories pc ON pc.project_id = NEW.id;
END;

-- Trigger: category inserted → refresh FTS entry for that project
CREATE TRIGGER IF NOT EXISTS categories_ai AFTER INSERT ON program_categories BEGIN
  DELETE FROM projects_fts WHERE project_id = NEW.project_id;
  INSERT INTO projects_fts(project_id, name, description, category, tags, aliases)
  SELECT p.id, p.name, COALESCE(p.description, ''),
         NEW.category, COALESCE(NEW.tags, ''), COALESCE(NEW.aliases, '')
  FROM projects p
  WHERE p.id = NEW.project_id;
END;

-- Trigger: category updated → refresh FTS entry for that project
CREATE TRIGGER IF NOT EXISTS categories_au AFTER UPDATE ON program_categories BEGIN
  DELETE FROM projects_fts WHERE project_id = NEW.project_id;
  INSERT INTO projects_fts(project_id, name, description, category, tags, aliases)
  SELECT p.id, p.name, COALESCE(p.description, ''),
         NEW.category, COALESCE(NEW.tags, ''), COALESCE(NEW.aliases, '')
  FROM projects p
  WHERE p.id = NEW.project_id;
END;
