-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_program_id ON projects(program_id);
CREATE INDEX IF NOT EXISTS idx_projects_is_public ON projects(is_public);

CREATE INDEX IF NOT EXISTS idx_idl_versions_project_id ON idl_versions(project_id);
CREATE INDEX IF NOT EXISTS idx_idl_versions_created_at ON idl_versions(created_at);

CREATE INDEX IF NOT EXISTS idx_api_keys_project_id ON api_keys(project_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);

CREATE INDEX IF NOT EXISTS idx_project_socials_project_id ON project_socials(project_id);
