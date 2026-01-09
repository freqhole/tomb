-- Migration: Add soft-delete support to metadata tables (genres, sub-genres, tags)
-- This allows genres, sub-genres, and tags to be soft-deleted and later hard-deleted by maintenance jobs
-- instead of immediately removing them and breaking relationships

-- Add deleted_at and deleted_by to genrez
ALTER TABLE genrez ADD COLUMN deleted_at INTEGER;
ALTER TABLE genrez ADD COLUMN deleted_by TEXT;

-- Add deleted_at and deleted_by to sub_genrez
ALTER TABLE sub_genrez ADD COLUMN deleted_at INTEGER;
ALTER TABLE sub_genrez ADD COLUMN deleted_by TEXT;

-- Add deleted_at and deleted_by to tagz
ALTER TABLE tagz ADD COLUMN deleted_at INTEGER;
ALTER TABLE tagz ADD COLUMN deleted_by TEXT;

-- Create indexes for efficient querying of non-deleted items
CREATE INDEX idx_genrez_deleted_at ON genrez(deleted_at);
CREATE INDEX idx_sub_genrez_deleted_at ON sub_genrez(deleted_at);
CREATE INDEX idx_tagz_deleted_at ON tagz(deleted_at);
