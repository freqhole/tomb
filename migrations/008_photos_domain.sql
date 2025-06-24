-- Photos Domain Table
-- This migration creates the photos domain table for image metadata and organization

-- Create photos table for image domain
CREATE TABLE photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_blob_id UUID NOT NULL REFERENCES media_blobs(id) ON DELETE CASCADE,
    thumbnail_blob_id UUID REFERENCES media_blobs(id) ON DELETE SET NULL,
    title TEXT,
    caption TEXT,
    alt_text TEXT,
    location TEXT,
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    taken_at TIMESTAMPTZ,
    camera_make TEXT,
    camera_model TEXT,
    lens_info TEXT,
    focal_length INTEGER CHECK (focal_length > 0),
    aperture DECIMAL(3,1) CHECK (aperture > 0),
    shutter_speed TEXT,
    iso INTEGER CHECK (iso > 0),
    flash_used BOOLEAN,
    orientation INTEGER CHECK (orientation >= 1 AND orientation <= 8),
    width_px INTEGER CHECK (width_px > 0),
    height_px INTEGER CHECK (height_px > 0),
    color_space TEXT,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    is_favorite BOOLEAN DEFAULT false,
    tags TEXT[] DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT txid_current()
);

-- Add comments for photos table
COMMENT ON TABLE photos IS 'Photos domain: image metadata, EXIF data, and organization';
COMMENT ON COLUMN photos.media_blob_id IS 'Reference to the actual image file blob';
COMMENT ON COLUMN photos.thumbnail_blob_id IS 'Reference to generated thumbnail blob';
COMMENT ON COLUMN photos.alt_text IS 'Alternative text for accessibility';
COMMENT ON COLUMN photos.location IS 'Human-readable location description';
COMMENT ON COLUMN photos.latitude IS 'GPS latitude coordinate (WGS84)';
COMMENT ON COLUMN photos.longitude IS 'GPS longitude coordinate (WGS84)';
COMMENT ON COLUMN photos.taken_at IS 'When the photo was actually taken (from EXIF)';
COMMENT ON COLUMN photos.focal_length IS 'Lens focal length in millimeters';
COMMENT ON COLUMN photos.aperture IS 'F-stop value (e.g., 2.8 for f/2.8)';
COMMENT ON COLUMN photos.shutter_speed IS 'Shutter speed as string (e.g., "1/60", "2s")';
COMMENT ON COLUMN photos.iso IS 'ISO sensitivity value';
COMMENT ON COLUMN photos.orientation IS 'EXIF orientation value (1-8)';
COMMENT ON COLUMN photos.width_px IS 'Image width in pixels';
COMMENT ON COLUMN photos.height_px IS 'Image height in pixels';
COMMENT ON COLUMN photos.color_space IS 'Color space (sRGB, Adobe RGB, etc.)';
COMMENT ON COLUMN photos.tags IS 'User-defined tags for organization';
COMMENT ON COLUMN photos.metadata IS 'Extended EXIF data, face detection, AI tags, etc.';

-- Create indexes for photos table
CREATE INDEX idx_photos_media_blob_id ON photos(media_blob_id);
CREATE INDEX idx_photos_title ON photos(title) WHERE deleted_at IS NULL;
CREATE INDEX idx_photos_taken_at ON photos(taken_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_photos_location ON photos(location) WHERE deleted_at IS NULL;
CREATE INDEX idx_photos_camera_make ON photos(camera_make) WHERE deleted_at IS NULL;
CREATE INDEX idx_photos_camera_model ON photos(camera_model) WHERE deleted_at IS NULL;
CREATE INDEX idx_photos_rating ON photos(rating) WHERE deleted_at IS NULL;
CREATE INDEX idx_photos_is_favorite ON photos(is_favorite) WHERE deleted_at IS NULL;
CREATE INDEX idx_photos_deleted_at ON photos(deleted_at);
CREATE INDEX idx_photos_active ON photos(id) WHERE deleted_at IS NULL;
CREATE INDEX idx_photos_version ON photos(version);
CREATE INDEX idx_photos_created_at ON photos(created_at) WHERE deleted_at IS NULL;

-- Spatial index for GPS coordinates
CREATE INDEX idx_photos_location_coords ON photos(latitude, longitude)
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND deleted_at IS NULL;

-- Composite indexes for common queries
CREATE INDEX idx_photos_camera_info ON photos(camera_make, camera_model) WHERE deleted_at IS NULL;
CREATE INDEX idx_photos_technical ON photos(focal_length, aperture, iso) WHERE deleted_at IS NULL;
CREATE INDEX idx_photos_date_location ON photos(taken_at, location) WHERE deleted_at IS NULL;
CREATE INDEX idx_photos_dimensions ON photos(width_px, height_px) WHERE deleted_at IS NULL;

-- GIN index for tags array
CREATE INDEX idx_photos_tags ON photos USING GIN(tags) WHERE deleted_at IS NULL;

-- GIN index for metadata JSONB
CREATE INDEX idx_photos_metadata ON photos USING GIN(metadata) WHERE deleted_at IS NULL;

-- Create view for active photos
CREATE VIEW active_photos AS
SELECT * FROM photos WHERE deleted_at IS NULL;

-- Create trigger for updated_at timestamp
CREATE TRIGGER update_photos_updated_at
    BEFORE UPDATE ON photos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create view for photos with file information
CREATE VIEW photos_with_files AS
SELECT
    p.*,
    mb.mime,
    mb.size,
    mb.local_path,
    thumb.id as thumbnail_id,
    thumb.mime as thumbnail_mime,
    thumb.size as thumbnail_size
FROM photos p
JOIN media_blobs mb ON p.media_blob_id = mb.id
LEFT JOIN media_blobs thumb ON p.thumbnail_blob_id = thumb.id
WHERE p.deleted_at IS NULL
AND mb.deleted_at IS NULL;

-- Function to calculate photo aspect ratio
CREATE OR REPLACE FUNCTION photo_aspect_ratio(width INTEGER, height INTEGER)
RETURNS DECIMAL(10,6) AS $$
BEGIN
    IF height = 0 OR height IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN width::DECIMAL / height::DECIMAL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to categorize photos by dimensions
CREATE OR REPLACE FUNCTION photo_orientation_category(width INTEGER, height INTEGER)
RETURNS TEXT AS $$
BEGIN
    IF width IS NULL OR height IS NULL THEN
        RETURN 'unknown';
    END IF;

    IF width > height THEN
        RETURN 'landscape';
    ELSIF height > width THEN
        RETURN 'portrait';
    ELSE
        RETURN 'square';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to format camera info as display string
CREATE OR REPLACE FUNCTION format_camera_info(make TEXT, model TEXT, lens TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN TRIM(CONCAT_WS(' ', make, model,
        CASE WHEN lens IS NOT NULL THEN CONCAT('(', lens, ')') END));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to find photos within radius of coordinates
CREATE OR REPLACE FUNCTION find_photos_near_location(
    center_lat DECIMAL(10,8),
    center_lng DECIMAL(11,8),
    radius_km DECIMAL DEFAULT 1.0,
    max_results INTEGER DEFAULT 100
)
RETURNS TABLE (
    photo_id UUID,
    title TEXT,
    distance_km DECIMAL,
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.title,
        -- Haversine distance calculation (approximate)
        (6371 * acos(
            cos(radians(center_lat)) *
            cos(radians(p.latitude)) *
            cos(radians(p.longitude) - radians(center_lng)) +
            sin(radians(center_lat)) *
            sin(radians(p.latitude))
        ))::DECIMAL(10,3) as distance_km,
        p.latitude,
        p.longitude
    FROM photos p
    WHERE p.latitude IS NOT NULL
    AND p.longitude IS NOT NULL
    AND p.deleted_at IS NULL
    AND (6371 * acos(
        cos(radians(center_lat)) *
        cos(radians(p.latitude)) *
        cos(radians(p.longitude) - radians(center_lng)) +
        sin(radians(center_lat)) *
        sin(radians(p.latitude))
    )) <= radius_km
    ORDER BY distance_km
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

-- Create materialized view for photo statistics (refresh as needed)
CREATE MATERIALIZED VIEW photo_statistics AS
SELECT
    COUNT(*) as total_photos,
    COUNT(*) FILTER (WHERE taken_at IS NOT NULL) as photos_with_date,
    COUNT(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL) as photos_with_gps,
    COUNT(*) FILTER (WHERE rating IS NOT NULL) as rated_photos,
    COUNT(*) FILTER (WHERE is_favorite = true) as favorite_photos,
    COUNT(DISTINCT camera_make) as unique_camera_makes,
    COUNT(DISTINCT camera_model) as unique_camera_models,
    AVG(rating) as average_rating,
    MIN(taken_at) as earliest_photo,
    MAX(taken_at) as latest_photo,
    SUM(width_px * height_px) as total_megapixels
FROM active_photos;

-- Create index on materialized view
CREATE UNIQUE INDEX idx_photo_statistics_singleton ON photo_statistics(total_photos);
