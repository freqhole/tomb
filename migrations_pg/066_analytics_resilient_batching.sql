-- Migration: 066_analytics_resilient_batching.sql
-- Add domain_ids array column and remove foreign key constraints for loose coupling and resilient batching

-- Add domain_ids array column for multi-item collections (only if it doesn't exist)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'media_events' AND column_name = 'domain_ids') THEN
        ALTER TABLE media_events ADD COLUMN domain_ids TEXT[];
    END IF;
END $$;

-- Remove foreign key constraints for operational flexibility
ALTER TABLE media_events DROP CONSTRAINT IF EXISTS media_events_media_blob_id_fkey;
ALTER TABLE media_events DROP CONSTRAINT IF EXISTS media_events_user_id_fkey;

-- Add new event types for social feed
ALTER TABLE media_events DROP CONSTRAINT IF EXISTS chk_event_type;
ALTER TABLE media_events ADD CONSTRAINT chk_event_type
    CHECK (event_type IN (
        'play', 'pause', 'resume', 'seek', 'complete', 'stop',
        'rate', 'favorite', 'unfavorite', 'tag', 'untag',
        'download', 'share', 'view', 'thumbnail_click',
        'playlist_add', 'playlist_remove', 'skip', 'repeat',
        'shuffle', 'volume_change', 'quality_change',
        'fullscreen', 'picture_in_picture', 'cast',
        'upload', 'create_playlist', 'add_to_playlist'
    ));

-- Update collection domain constraint to support either domain_id or domain_ids
ALTER TABLE media_events DROP CONSTRAINT IF EXISTS chk_collection_domain;
ALTER TABLE media_events ADD CONSTRAINT chk_collection_domain_flexible
    CHECK (
        (media_blob_id IS NOT NULL) OR
        (media_blob_id IS NULL AND domain_type IS NOT NULL AND
         (domain_id IS NOT NULL OR (domain_ids IS NOT NULL AND array_length(domain_ids, 1) > 0)))
    );

-- Add index for client_id lookups during batch processing (if not exists)
CREATE INDEX IF NOT EXISTS idx_media_events_client_id ON media_events (client_id)
WHERE client_id IS NOT NULL;

-- Add index for domain_ids array queries
CREATE INDEX IF NOT EXISTS idx_media_events_domain_ids_gin ON media_events USING gin (domain_ids)
WHERE domain_ids IS NOT NULL;

-- Add combined index for feed queries with domain_ids
CREATE INDEX IF NOT EXISTS idx_media_events_feed_domain_ids ON media_events
(created_at DESC, domain_type, event_type)
WHERE event_type = 'play' AND domain_ids IS NOT NULL;

-- Comment explaining the domain_ids column
COMMENT ON COLUMN media_events.domain_ids IS 'Array of row IDs for multi-item collections. Songs use UUID primary keys, playlists use UUIDs. Always use arrays even for single items.';
COMMENT ON COLUMN media_events.client_id IS 'Client-generated UUID for batch correlation and resilient processing';
