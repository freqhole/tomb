-- Video Playlists Table Migration
-- This migration creates the video_playlists table for video collections and the video_playlist_items join table

-- Create video_playlists table for video collections
CREATE TABLE video_playlists (
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

-- Add comments for video_playlists table
COMMENT ON TABLE video_playlists IS 'Video playlists for organizing videos';
COMMENT ON COLUMN video_playlists.media_blob_id IS 'Reference to exported playlist file blob (optional)';
COMMENT ON COLUMN video_playlists.thumbnail_blob_id IS 'Reference to playlist cover video thumbnail blob';
COMMENT ON COLUMN video_playlists.client_id IS 'Client application that created this playlist';
COMMENT ON COLUMN video_playlists.is_public IS 'Whether playlist is visible to other users';
COMMENT ON COLUMN video_playlists.is_collaborative IS 'Whether other users can add/remove videos';
COMMENT ON COLUMN video_playlists.metadata IS 'Playlist metadata (theme, auto-generated info, etc.)';

-- Create indexes for video_playlists table
CREATE INDEX idx_video_playlists_title ON video_playlists(title) WHERE deleted_at IS NULL;
CREATE INDEX idx_video_playlists_client_id ON video_playlists(client_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_video_playlists_is_public ON video_playlists(is_public) WHERE deleted_at IS NULL;
CREATE INDEX idx_video_playlists_deleted_at ON video_playlists(deleted_at);
CREATE INDEX idx_video_playlists_active ON video_playlists(id) WHERE deleted_at IS NULL;
CREATE INDEX idx_video_playlists_version ON video_playlists(version);
CREATE INDEX idx_video_playlists_created_at ON video_playlists(created_at) WHERE deleted_at IS NULL;

-- GIN index for video playlist metadata
CREATE INDEX idx_video_playlists_metadata ON video_playlists USING GIN(metadata) WHERE deleted_at IS NULL;

-- Create video_playlist_items join table
CREATE TABLE video_playlist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID NOT NULL REFERENCES video_playlists(id) ON DELETE CASCADE,
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    added_by_client_id TEXT,
    metadata JSONB DEFAULT '{}'
);

-- Add comments for video_playlist_items table
COMMENT ON TABLE video_playlist_items IS 'Many-to-many relationship between video playlists and videos';
COMMENT ON COLUMN video_playlist_items.position IS 'Order of video within playlist (1-based)';
COMMENT ON COLUMN video_playlist_items.created_at IS 'When this video was added to the playlist';
COMMENT ON COLUMN video_playlist_items.added_by_client_id IS 'Client that added this video to the playlist';
COMMENT ON COLUMN video_playlist_items.metadata IS 'Video-specific metadata within this playlist context';

-- Create indexes for video_playlist_items table
CREATE INDEX idx_video_playlist_items_playlist_id ON video_playlist_items(playlist_id);
CREATE INDEX idx_video_playlist_items_video_id ON video_playlist_items(video_id);
CREATE INDEX idx_video_playlist_items_position ON video_playlist_items(playlist_id, position);
CREATE INDEX idx_video_playlist_items_created_at ON video_playlist_items(created_at);

-- Unique constraints for video_playlist_items
CREATE UNIQUE INDEX idx_video_playlist_items_unique_video ON video_playlist_items(playlist_id, video_id);
CREATE UNIQUE INDEX idx_video_playlist_items_unique_position ON video_playlist_items(playlist_id, position);

-- Create trigger for updated_at timestamp on video_playlists
CREATE TRIGGER update_video_playlists_updated_at
    BEFORE UPDATE ON video_playlists
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
