-- Make media_blob_id nullable for collection analytics
-- Migration: 063_nullable_media_blob_id.sql

-- Remove the NOT NULL constraint and foreign key constraint
ALTER TABLE media_events DROP CONSTRAINT media_events_media_blob_id_fkey;
ALTER TABLE media_events ALTER COLUMN media_blob_id DROP NOT NULL;

-- Add the foreign key constraint back, but allow NULL values
ALTER TABLE media_events ADD CONSTRAINT media_events_media_blob_id_fkey
    FOREIGN KEY (media_blob_id) REFERENCES media_blobs(id) ON DELETE CASCADE;

-- Update indexes to handle NULL values properly
DROP INDEX IF EXISTS idx_media_events_blob_id;
DROP INDEX IF EXISTS idx_media_events_blob_type_date;
DROP INDEX IF EXISTS idx_media_events_plays;
DROP INDEX IF EXISTS idx_media_events_ratings;

-- Recreate indexes with NULL handling
CREATE INDEX idx_media_events_blob_id ON media_events(media_blob_id) WHERE media_blob_id IS NOT NULL;
CREATE INDEX idx_media_events_blob_type_date ON media_events(media_blob_id, event_type, created_at) WHERE media_blob_id IS NOT NULL;

-- Partial indexes for specific event types
CREATE INDEX idx_media_events_plays ON media_events(media_blob_id, created_at)
    WHERE event_type = 'play' AND media_blob_id IS NOT NULL;

CREATE INDEX idx_media_events_ratings ON media_events(media_blob_id, created_at)
    WHERE event_type = 'rate' AND event_data->>'rating' IS NOT NULL AND media_blob_id IS NOT NULL;

-- Add new indexes for collection analytics (where media_blob_id IS NULL)
CREATE INDEX idx_media_events_collections ON media_events(domain_type, domain_id, event_type, created_at)
    WHERE media_blob_id IS NULL;

CREATE INDEX idx_media_events_collection_plays ON media_events(domain_type, domain_id, created_at)
    WHERE event_type = 'play' AND media_blob_id IS NULL;

-- Update the analytics views to handle NULL media_blob_id
DROP VIEW IF EXISTS media_analytics;
CREATE VIEW media_analytics AS
SELECT
    media_blob_id,
    COUNT(*) FILTER (WHERE event_type = 'play') as play_count,
    COUNT(*) FILTER (WHERE event_type = 'complete') as completion_count,
    COUNT(*) FILTER (WHERE event_type = 'download') as download_count,
    COUNT(*) FILTER (WHERE event_type = 'share') as share_count,
    COUNT(*) FILTER (WHERE event_type = 'favorite') as favorite_count,
    MAX(created_at) FILTER (WHERE event_type = 'play') as last_played_at,
    AVG((event_data->>'rating')::INTEGER) FILTER (WHERE event_type = 'rate') as avg_rating,
    COUNT(*) FILTER (WHERE event_type = 'rate') as rating_count,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(DISTINCT session_id) as unique_sessions,
    MIN(created_at) as first_interaction,
    MAX(created_at) as last_interaction
FROM media_events
WHERE user_id IS NOT NULL AND media_blob_id IS NOT NULL -- Only include events with actual media blobs
GROUP BY media_blob_id;

-- Add new view for collection analytics
CREATE VIEW collection_analytics AS
SELECT
    domain_type,
    domain_id,
    COUNT(*) FILTER (WHERE event_type = 'play') as play_count,
    COUNT(*) FILTER (WHERE event_type = 'complete') as completion_count,
    COUNT(*) FILTER (WHERE event_type = 'shuffle') as shuffle_count,
    MAX(created_at) FILTER (WHERE event_type = 'play') as last_played_at,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(DISTINCT session_id) as unique_sessions,
    MIN(created_at) as first_interaction,
    MAX(created_at) as last_interaction,
    -- Extract collection metadata from event_data
    MAX(event_data->>'total_songs')::INTEGER as total_songs,
    COUNT(*) FILTER (WHERE event_data->>'shuffle_enabled' = 'true') as shuffle_plays
FROM media_events
WHERE user_id IS NOT NULL
    AND media_blob_id IS NULL
    AND domain_type IS NOT NULL
    AND domain_id IS NOT NULL
GROUP BY domain_type, domain_id;

-- Update the top media function to handle collections
DROP FUNCTION IF EXISTS get_top_media_by_engagement(INTEGER, INTEGER, TEXT);
CREATE OR REPLACE FUNCTION get_top_media_by_engagement(
    days_back INTEGER DEFAULT 30,
    limit_count INTEGER DEFAULT 20,
    domain_filter TEXT DEFAULT NULL,
    include_collections BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    media_blob_id VARCHAR(16),
    domain_type VARCHAR(20),
    domain_id UUID,
    play_count BIGINT,
    unique_users BIGINT,
    avg_rating DECIMAL(3,2),
    last_played TIMESTAMPTZ,
    is_collection BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        me.media_blob_id,
        me.domain_type,
        me.domain_id,
        COUNT(*) FILTER (WHERE me.event_type = 'play'),
        COUNT(DISTINCT me.user_id),
        AVG((me.event_data->>'rating')::INTEGER) FILTER (WHERE me.event_type = 'rate'),
        MAX(me.created_at) FILTER (WHERE me.event_type = 'play'),
        (me.media_blob_id IS NULL) as is_collection
    FROM media_events me
    WHERE me.created_at >= NOW() - INTERVAL '1 day' * days_back
    AND (domain_filter IS NULL OR me.domain_type = domain_filter)
    AND (include_collections OR me.media_blob_id IS NOT NULL)
    GROUP BY me.media_blob_id, me.domain_type, me.domain_id
    HAVING COUNT(*) FILTER (WHERE me.event_type = 'play') > 0
    ORDER BY COUNT(*) FILTER (WHERE me.event_type = 'play') DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Update comments to reflect nullable media_blob_id
COMMENT ON COLUMN media_events.media_blob_id IS 'Reference to the media blob that was interacted with (NULL for collection-level events)';

-- Update constraint to include new domain types for collections
ALTER TABLE media_events DROP CONSTRAINT IF EXISTS chk_domain_type;
ALTER TABLE media_events ADD CONSTRAINT chk_domain_type
    CHECK (domain_type IS NULL OR domain_type IN ('song', 'album', 'artist', 'genre', 'playlist', 'photo', 'video', 'book', 'document'));

-- Add constraint to ensure collection events have domain info
ALTER TABLE media_events ADD CONSTRAINT chk_collection_domain
    CHECK (
        (media_blob_id IS NOT NULL) OR
        (media_blob_id IS NULL AND domain_type IS NOT NULL AND domain_id IS NOT NULL)
    );
