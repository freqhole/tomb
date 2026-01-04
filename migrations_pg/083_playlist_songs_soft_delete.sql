-- Add soft delete columns to playlist_songs table
-- This migration adds deleted_at and deleted_by columns to enable soft deletes for playlist songs

-- Add deleted_at and deleted_by columns to playlist_songs
ALTER TABLE playlist_songs ADD COLUMN deleted_at TIMESTAMPTZ;
ALTER TABLE playlist_songs ADD COLUMN deleted_by UUID REFERENCES users(id);

-- Add comments for new columns
COMMENT ON COLUMN playlist_songs.deleted_at IS 'Timestamp when this playlist song relationship was soft deleted';
COMMENT ON COLUMN playlist_songs.deleted_by IS 'User who deleted this playlist song relationship';

-- Create index for deleted_at column for efficient filtering
CREATE INDEX idx_playlist_songs_deleted_at ON playlist_songs(deleted_at);

-- Create index for active playlist songs (where deleted_at IS NULL)
CREATE INDEX idx_playlist_songs_active ON playlist_songs(playlist_id, position) WHERE deleted_at IS NULL;

-- Update existing indexes to filter out deleted items
-- Drop old indexes that don't filter deleted items
DROP INDEX IF EXISTS idx_playlist_songs_unique_song;
DROP INDEX IF EXISTS idx_playlist_songs_unique_position;
DROP INDEX IF EXISTS idx_playlist_songs_position;

-- Recreate unique constraints that only apply to active (non-deleted) items
CREATE UNIQUE INDEX idx_playlist_songs_unique_song_active ON playlist_songs(playlist_id, song_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_playlist_songs_unique_position_active ON playlist_songs(playlist_id, position) WHERE deleted_at IS NULL;

-- Recreate position index for active items only
CREATE INDEX idx_playlist_songs_position_active ON playlist_songs(playlist_id, position) WHERE deleted_at IS NULL;

-- Add composite index for sync queries (playlist_id, created_at) including deleted items
CREATE INDEX idx_playlist_songs_sync ON playlist_songs(playlist_id, created_at);

-- Add index for global sync queries (created_at) including deleted items
CREATE INDEX idx_playlist_songs_sync_global ON playlist_songs(created_at);
