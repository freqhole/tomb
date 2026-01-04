-- Galleries Tables Migration
-- This migration creates the galleries table for photo collections and the photo_galleries join table

-- Create galleries table for photo collections
CREATE TABLE galleries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_blob_id VARCHAR(16) REFERENCES media_blobs(id) ON DELETE SET NULL,
    thumbnail_blob_id VARCHAR(16) REFERENCES media_blobs(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    client_id TEXT,
    is_public BOOLEAN DEFAULT false,
    is_collaborative BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}',
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT txid_current()
);

-- Add comments for galleries table
COMMENT ON TABLE galleries IS 'Photo galleries for organizing photos';
COMMENT ON COLUMN galleries.media_blob_id IS 'Reference to exported gallery file blob (optional)';
COMMENT ON COLUMN galleries.thumbnail_blob_id IS 'Reference to gallery cover photo blob';
COMMENT ON COLUMN galleries.client_id IS 'Client application that created this gallery';
COMMENT ON COLUMN galleries.is_public IS 'Whether gallery is visible to other users';
COMMENT ON COLUMN galleries.is_collaborative IS 'Whether other users can add/remove photos';
COMMENT ON COLUMN galleries.metadata IS 'Gallery metadata (theme, auto-generated info, etc.)';

-- Create indexes for galleries table
CREATE INDEX idx_galleries_title ON galleries(title) WHERE deleted_at IS NULL;
CREATE INDEX idx_galleries_client_id ON galleries(client_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_galleries_is_public ON galleries(is_public) WHERE deleted_at IS NULL;
CREATE INDEX idx_galleries_deleted_at ON galleries(deleted_at);
CREATE INDEX idx_galleries_active ON galleries(id) WHERE deleted_at IS NULL;
CREATE INDEX idx_galleries_version ON galleries(version);
CREATE INDEX idx_galleries_created_at ON galleries(created_at) WHERE deleted_at IS NULL;

-- GIN index for gallery metadata
CREATE INDEX idx_galleries_metadata ON galleries USING GIN(metadata) WHERE deleted_at IS NULL;

-- Create photo_galleries join table
CREATE TABLE photo_galleries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gallery_id UUID NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
    photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    added_by_client_id TEXT,
    metadata JSONB DEFAULT '{}'
);

-- Add comments for photo_galleries table
COMMENT ON TABLE photo_galleries IS 'Many-to-many relationship between galleries and photos';
COMMENT ON COLUMN photo_galleries.position IS 'Order of photo within gallery (1-based)';
COMMENT ON COLUMN photo_galleries.created_at IS 'When this photo was added to the gallery';
COMMENT ON COLUMN photo_galleries.added_by_client_id IS 'Client that added this photo to the gallery';
COMMENT ON COLUMN photo_galleries.metadata IS 'Photo-specific metadata within this gallery context';

-- Create indexes for photo_galleries table
CREATE INDEX idx_photo_galleries_gallery_id ON photo_galleries(gallery_id);
CREATE INDEX idx_photo_galleries_photo_id ON photo_galleries(photo_id);
CREATE INDEX idx_photo_galleries_position ON photo_galleries(gallery_id, position);
CREATE INDEX idx_photo_galleries_created_at ON photo_galleries(created_at);

-- Unique constraints for photo_galleries
CREATE UNIQUE INDEX idx_photo_galleries_unique_photo ON photo_galleries(gallery_id, photo_id);
CREATE UNIQUE INDEX idx_photo_galleries_unique_position ON photo_galleries(gallery_id, position);

-- Create trigger for updated_at timestamp on galleries
CREATE TRIGGER update_galleries_updated_at
    BEFORE UPDATE ON galleries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
