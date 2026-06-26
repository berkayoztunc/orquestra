-- Rebuild FTS5 index with better text search:
-- same columns as 008 but fixes multi-word and escaping in the service layer.
-- No schema changes needed vs 008; this migration is a clean rebuild
-- to ensure triggers are correct and index is in sync.

DROP TRIGGER IF EXISTS projects_ai;
DROP TRIGGER IF EXISTS projects_ad;
DROP TRIGGER IF EXISTS projects_au;
DROP TRIGGER IF EXISTS categories_ai;
DROP TRIGGER IF EXISTS categories_au;

DROP TABLE IF EXISTS projects_fts;

-- Column order: project_id(UNINDEXED), name, description, category, tags, aliases
-- BM25 weights: 0, 10, 2, 5, 8, 8
CREATE VIRTUAL TABLE projects_fts USING fts5(
  project_id UNINDEXED,
  name,
  description,
  category,
  tags,
  aliases
);

-- Backfill all existing projects
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
CREATE TRIGGER projects_ai AFTER INSERT ON projects BEGIN
  INSERT INTO projects_fts(project_id, name, description, category, tags, aliases)
  VALUES (NEW.id, NEW.name, COALESCE(NEW.description, ''), '', '', '');
END;

-- Trigger: project deleted
CREATE TRIGGER projects_ad AFTER DELETE ON projects BEGIN
  DELETE FROM projects_fts WHERE project_id = OLD.id;
END;

-- Trigger: project updated (DELETE + INSERT to refresh)
CREATE TRIGGER projects_au AFTER UPDATE ON projects BEGIN
  DELETE FROM projects_fts WHERE project_id = OLD.id;
  INSERT INTO projects_fts(project_id, name, description, category, tags, aliases)
  SELECT NEW.id, NEW.name, COALESCE(NEW.description, ''),
         COALESCE(pc.category, ''), COALESCE(pc.tags, ''), COALESCE(pc.aliases, '')
  FROM (SELECT NULL) t
  LEFT JOIN program_categories pc ON pc.project_id = NEW.id;
END;

-- Trigger: category inserted → refresh FTS entry for that project
CREATE TRIGGER categories_ai AFTER INSERT ON program_categories BEGIN
  DELETE FROM projects_fts WHERE project_id = NEW.project_id;
  INSERT INTO projects_fts(project_id, name, description, category, tags, aliases)
  SELECT p.id, p.name, COALESCE(p.description, ''),
         NEW.category, COALESCE(NEW.tags, ''), COALESCE(NEW.aliases, '')
  FROM projects p
  WHERE p.id = NEW.project_id;
END;

-- Trigger: category updated → refresh FTS entry for that project
CREATE TRIGGER categories_au AFTER UPDATE ON program_categories BEGIN
  DELETE FROM projects_fts WHERE project_id = NEW.project_id;
  INSERT INTO projects_fts(project_id, name, description, category, tags, aliases)
  SELECT p.id, p.name, COALESCE(p.description, ''),
         NEW.category, COALESCE(NEW.tags, ''), COALESCE(NEW.aliases, '')
  FROM projects p
  WHERE p.id = NEW.project_id;
END;
