-- Create the built-in system user used for auto-imported / CLI-ingested projects.
-- github_id = -1 is a sentinel value (GitHub IDs are always positive integers).
INSERT OR IGNORE INTO users (id, github_id, username, email, avatar_url, created_at, updated_at)
VALUES (
  'system',
  -1,
  'system',
  'system@orquestra.dev',
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
