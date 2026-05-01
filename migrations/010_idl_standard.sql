-- Migration 010: Add idl_standard column to idl_versions
-- Tracks whether the IDL is in Anchor or Codama format.
-- Default 'anchor' preserves backward compatibility for all existing rows.
ALTER TABLE idl_versions ADD COLUMN idl_standard TEXT NOT NULL DEFAULT 'anchor';
