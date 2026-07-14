-- Add per-program verified build status to projects.
-- Populated by VerifiedBuildsWorkflow which checks OSEC API weekly.
ALTER TABLE projects ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN verified_at DATETIME;

CREATE INDEX IF NOT EXISTS idx_projects_is_verified ON projects(is_verified);
