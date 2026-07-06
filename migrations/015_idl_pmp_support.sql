-- Migration 015: Track IDL source (PMP vs Anchor)
-- Adds idl_source column to idl_versions to distinguish between
-- Program Metadata Program (PMP) IDLs and legacy Anchor IDLs.

ALTER TABLE idl_versions ADD COLUMN idl_source TEXT DEFAULT 'anchor';
CREATE INDEX idx_idl_versions_source ON idl_versions(idl_source);
