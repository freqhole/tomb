-- Media Blobs Storage
-- Table for WebSocket file sharing with metadata and optional binary data

CREATE TABLE IF NOT EXISTS media_blobs (
    id VARCHAR(16) PRIMARY KEY,  -- Short hash (7-16 chars), auto-generated from sha256
    sha256 CHAR(64) NOT NULL UNIQUE,  -- Full SHA256 hash for integrity and deduplication
    data BYTEA,
    size BIGINT,
    mime TEXT,
    source_client_id TEXT,
    local_path TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Validation constraints
ALTER TABLE media_blobs ADD CONSTRAINT chk_id_format
    CHECK (id ~ '^[a-f0-9]{7,16}$' AND length(id) >= 7);
ALTER TABLE media_blobs ADD CONSTRAINT chk_sha256_format
    CHECK (sha256 ~ '^[a-f0-9]{64}$');

-- Indexes for common query patterns (sha256 unique constraint provides deduplication)
CREATE INDEX IF NOT EXISTS idx_media_blobs_client_id ON media_blobs (source_client_id);
CREATE INDEX IF NOT EXISTS idx_media_blobs_created_at ON media_blobs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_blobs_local_path ON media_blobs (local_path);
CREATE INDEX IF NOT EXISTS idx_media_blobs_mime ON media_blobs (mime);

-- Function to auto-generate short hash IDs with collision resolution
CREATE OR REPLACE FUNCTION generate_short_id()
RETURNS TRIGGER AS $$
DECLARE
    attempt_length INT := 7;  -- Start with 7 chars
    candidate_id TEXT;
    max_attempts INT := 16;   -- Don't go beyond 16 chars
BEGIN
    -- Generate progressively longer short IDs until unique
    WHILE attempt_length <= max_attempts LOOP
        candidate_id := substring(NEW.sha256 FROM 1 FOR attempt_length);

        -- Check if this short ID already exists
        IF NOT EXISTS (
            SELECT 1 FROM media_blobs
            WHERE id = candidate_id
            AND sha256 != NEW.sha256
        ) THEN
            NEW.id := candidate_id;
            RETURN NEW;
        END IF;

        attempt_length := attempt_length + 1;
    END LOOP;

    -- Fallback to full hash (should never happen)
    NEW.id := NEW.sha256;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-generate short IDs
CREATE TRIGGER trigger_generate_short_id
    BEFORE INSERT OR UPDATE ON media_blobs
    FOR EACH ROW
    EXECUTE FUNCTION generate_short_id();

-- Optional: Add a trigger to automatically update updated_at
CREATE OR REPLACE FUNCTION update_media_blobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trigger_media_blobs_updated_at
    BEFORE UPDATE ON media_blobs
    FOR EACH ROW
    EXECUTE FUNCTION update_media_blobs_updated_at();

-- Add size constraint for data column to prevent storing files larger than 10MB
-- Only applies when data is NOT NULL
ALTER TABLE media_blobs ADD CONSTRAINT chk_data_size_limit
    CHECK (data IS NULL OR octet_length(data) <= 10485760);

-- Create a function to check if a bytea value would exceed the limit
-- This can be used before inserting data to validate size
CREATE OR REPLACE FUNCTION check_media_blob_data_size(data_blob BYTEA)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN data_blob IS NULL OR octet_length(data_blob) <= 10485760;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE media_blobs IS 'Stores media file metadata and optionally binary data for WebSocket file sharing';
COMMENT ON COLUMN media_blobs.data IS 'Optional binary data - limited to 10MB. Larger files should use local_path reference instead';
COMMENT ON COLUMN media_blobs.id IS 'Short hash (7-16 chars) auto-generated from SHA256 for human-readable URLs';
COMMENT ON COLUMN media_blobs.sha256 IS 'Full SHA256 hash for deduplication and integrity verification';
COMMENT ON COLUMN media_blobs.source_client_id IS 'Identifier of the client that uploaded this blob';
COMMENT ON COLUMN media_blobs.local_path IS 'Local filesystem path if data is stored externally';
COMMENT ON COLUMN media_blobs.metadata IS 'Additional metadata as JSON (dimensions, duration, etc.)';
COMMENT ON CONSTRAINT chk_data_size_limit ON media_blobs IS
    'Ensures binary data stored in database does not exceed 10MB. Larger files should use local_path reference instead.';
COMMENT ON FUNCTION check_media_blob_data_size(BYTEA) IS
    'Helper function to validate if bytea data is within 10MB limit before database insertion';
