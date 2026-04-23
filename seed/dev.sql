INSERT OR IGNORE INTO users (
  id,
  github_id,
  username,
  email,
  avatar_url,
  created_at,
  updated_at
)
VALUES (
  'user_1',
  12345,
  'developer1',
  'dev1@example.com',
  'https://avatars.githubusercontent.com/u/12345?v=4',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);