-- Enhance media_blobs table with thumbnails and versioning
-- This migration adds thumbnail relationships, soft deletes, and versioning to the existing media_blobs table

-- Add new columns to existing media_blobs table
ALTER TABLE media_blobs ADD COLUMN parent_blob_id UUID REFERENCES media_blobs(id);
ALTER TABLE media_blobs ADD COLUMN blob_type VARCHAR(20) NOT NULL DEFAULT 'original';
ALTER TABLE media_blobs ADD COLUMN version BIGINT NOT NULL DEFAULT txid_current();
ALTER TABLE media_blobs ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE media_blobs ADD COLUMN deleted_by UUID REFERENCES users(id);

-- Update local_path column to be TEXT for longer paths
ALTER TABLE media_blobs ALTER COLUMN local_path TYPE TEXT;

-- Add comments for documentation
COMMENT ON COLUMN media_blobs.local_path IS 'Full filesystem path (absolute, starting with /). Never exposed to clients.';
COMMENT ON COLUMN media_blobs.parent_blob_id IS 'Points to parent blob for thumbnails. NULL for original files.';
COMMENT ON COLUMN media_blobs.blob_type IS 'Type: original, thumbnail, waveform, preview';
COMMENT ON COLUMN media_blobs.version IS 'Transaction ID for optimistic locking and sync';
COMMENT ON COLUMN media_blobs.deleted_at IS 'Soft delete timestamp. NULL = active record';
COMMENT ON COLUMN media_blobs.deleted_by IS 'User who deleted this blob';

-- Create indexes for efficient querying
CREATE INDEX idx_media_blobs_version ON media_blobs(version);
CREATE INDEX idx_media_blobs_deleted_at ON media_blobs(deleted_at);
CREATE INDEX idx_media_blobs_active ON media_blobs(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_media_blobs_parent ON media_blobs(parent_blob_id);
CREATE INDEX idx_media_blobs_type ON media_blobs(blob_type);
CREATE INDEX idx_media_blobs_updated_at ON media_blobs(updated_at);

-- Composite index for finding thumbnails of a specific parent
CREATE INDEX idx_media_blobs_parent_type ON media_blobs(parent_blob_id, blob_type) WHERE deleted_at IS NULL;

-- View that filters out soft-deleted records (allows existing queries to work unchanged)
CREATE VIEW active_media_blobs AS
SELECT * FROM media_blobs WHERE deleted_at IS NULL;

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW() AT TIME ZONE 'UTC';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at on changes
CREATE TRIGGER update_media_blobs_updated_at
    BEFORE UPDATE ON media_blobs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add constraint to ensure blob_type values are valid
ALTER TABLE media_blobs ADD CONSTRAINT chk_blob_type
    CHECK (blob_type IN ('original', 'thumbnail', 'waveform', 'preview'));

-- Add constraint to ensure thumbnails have a parent
ALTER TABLE media_blobs ADD CONSTRAINT chk_thumbnail_has_parent
    CHECK ((blob_type = 'original' AND parent_blob_id IS NULL) OR
           (blob_type != 'original' AND parent_blob_id IS NOT NULL));

-- Add indexes for common query patterns
CREATE INDEX idx_media_blobs_mime ON media_blobs(mime) WHERE deleted_at IS NULL;
CREATE INDEX idx_media_blobs_size ON media_blobs(size) WHERE deleted_at IS NULL;
CREATE INDEX idx_media_blobs_created_at ON media_blobs(created_at) WHERE deleted_at IS NULL;

-- Performance: Partial indexes for different blob types
CREATE INDEX idx_media_blobs_originals ON media_blobs(id, created_at)
    WHERE blob_type = 'original' AND deleted_at IS NULL;

CREATE INDEX idx_media_blobs_thumbnails ON media_blobs(parent_blob_id, blob_type, created_at)
    WHERE blob_type = 'thumbnail' AND deleted_at IS NULL;
