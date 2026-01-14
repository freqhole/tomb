-- add content_id column to media_blobz for external content deduplication
-- used by fetch_music to track content from external sources (youtube, soundcloud, etc.)

ALTER TABLE media_blobz ADD COLUMN content_id TEXT;

-- index for fast content_id lookups during fetch precheck
CREATE INDEX idx_media_blobz_content_id ON media_blobz(content_id) WHERE content_id IS NOT NULL;

-- content_id format examples:
--   youtube: "dQw4w9WgXcQ" (video ID)
--   soundcloud: "123456789" (track ID)
--   platform-specific unique identifier extracted from metadata
