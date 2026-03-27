-- Migration 005: Make program_id globally unique (one project per Solana program)
-- Drop the old per-user unique constraint and add a global one.

-- SQLite doesn't support DROP CONSTRAINT directly.
-- The existing UNIQUE(user_id, program_id) is a table-level constraint from the CREATE TABLE.
-- We add a new unique index on program_id alone. The old composite unique still exists
-- but the new stricter index enforces global uniqueness.

CREATE UNIQUE INDEX idx_projects_program_id_unique ON projects(program_id);
