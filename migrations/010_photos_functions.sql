-- Photos Domain Functions and Views
-- This migration creates views, functions, triggers, and utilities for the photos domain

-- Create trigger for updated_at timestamp
CREATE TRIGGER update_photos_updated_at
    BEFORE UPDATE ON photos
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create view for active photos
CREATE VIEW active_photos AS
SELECT * FROM photos WHERE deleted_at IS NULL;

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
