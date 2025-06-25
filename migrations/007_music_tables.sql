-- Music Domain Tables
-- This migration creates the core music domain tables for songs and playlists

-- Create songs table for music domain
CREATE TABLE songs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_blob_id UUID NOT NULL REFERENCES media_blobs(id) ON DELETE CASCADE,
    thumbnail_blob_id UUID REFERENCES media_blobs(id) ON DELETE SET NULL,
    waveform_blob_id UUID REFERENCES media_blobs(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    artist TEXT,
    album TEXT,
    album_artist TEXT,
    track_number INTEGER,
    disc_number INTEGER DEFAULT 1,
    duration INTERVAL,
    genre TEXT,
    year INTEGER,
    bpm INTEGER CHECK (bpm > 0 AND bpm <= 300),
    key_signature TEXT,
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

-- Add comments for songs table
COMMENT ON TABLE songs IS 'Music domain: songs and track metadata';
COMMENT ON COLUMN songs.media_blob_id IS 'Reference to the actual audio file blob';
COMMENT ON COLUMN songs.thumbnail_blob_id IS 'Reference to album art/cover image blob';
COMMENT ON COLUMN songs.waveform_blob_id IS 'Reference to generated audio waveform visualization blob';
COMMENT ON COLUMN songs.album_artist IS 'Album artist (different from track artist for compilations)';
COMMENT ON COLUMN songs.disc_number IS 'Disc number for multi-disc albums';
COMMENT ON COLUMN songs.bpm IS 'Beats per minute for tempo';
COMMENT ON COLUMN songs.key_signature IS 'Musical key (e.g., "C major", "A minor")';
COMMENT ON COLUMN songs.tags IS 'User-defined tags for organization';
COMMENT ON COLUMN songs.metadata IS 'Extended metadata (lyrics, mood, instruments, etc.)';

-- Create indexes for songs table
CREATE INDEX idx_songs_media_blob_id ON songs(media_blob_id);
CREATE INDEX idx_songs_title ON songs(title) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_artist ON songs(artist) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_album ON songs(album) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_album_artist ON songs(album_artist) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_genre ON songs(genre) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_year ON songs(year) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_rating ON songs(rating) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_is_favorite ON songs(is_favorite) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_deleted_at ON songs(deleted_at);
CREATE INDEX idx_songs_active ON songs(id) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_version ON songs(version);
CREATE INDEX idx_songs_created_at ON songs(created_at) WHERE deleted_at IS NULL;

-- Composite indexes for common queries
CREATE INDEX idx_songs_album_track ON songs(album, disc_number, track_number) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_artist_album ON songs(artist, album) WHERE deleted_at IS NULL;
CREATE INDEX idx_songs_search ON songs(title, artist, album) WHERE deleted_at IS NULL;

-- GIN index for tags array
CREATE INDEX idx_songs_tags ON songs USING GIN(tags) WHERE deleted_at IS NULL;

-- GIN index for metadata JSONB
CREATE INDEX idx_songs_metadata ON songs USING GIN(metadata) WHERE deleted_at IS NULL;

-- Create playlists table
CREATE TABLE playlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_blob_id UUID REFERENCES media_blobs(id) ON DELETE SET NULL,
    thumbnail_blob_id UUID REFERENCES media_blobs(id) ON DELETE SET NULL,
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

-- Add comments for playlists table
COMMENT ON TABLE playlists IS 'Music playlists for organizing songs';
COMMENT ON COLUMN playlists.media_blob_id IS 'Reference to exported playlist file blob (optional)';
COMMENT ON COLUMN playlists.thumbnail_blob_id IS 'Reference to playlist cover art blob';
COMMENT ON COLUMN playlists.client_id IS 'Client application that created this playlist';
COMMENT ON COLUMN playlists.is_public IS 'Whether playlist is visible to other users';
COMMENT ON COLUMN playlists.is_collaborative IS 'Whether other users can add/remove songs';
COMMENT ON COLUMN playlists.metadata IS 'Playlist metadata (mood, genre, auto-generated info, etc.)';

-- Create indexes for playlists table
CREATE INDEX idx_playlists_title ON playlists(title) WHERE deleted_at IS NULL;
CREATE INDEX idx_playlists_client_id ON playlists(client_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_playlists_is_public ON playlists(is_public) WHERE deleted_at IS NULL;
CREATE INDEX idx_playlists_deleted_at ON playlists(deleted_at);
CREATE INDEX idx_playlists_active ON playlists(id) WHERE deleted_at IS NULL;
CREATE INDEX idx_playlists_version ON playlists(version);
CREATE INDEX idx_playlists_created_at ON playlists(created_at) WHERE deleted_at IS NULL;

-- GIN index for playlist metadata
CREATE INDEX idx_playlists_metadata ON playlists USING GIN(metadata) WHERE deleted_at IS NULL;

-- Create playlist_songs join table
CREATE TABLE playlist_songs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    added_by_client_id TEXT,
    metadata JSONB DEFAULT '{}'
);

-- Add comments for playlist_songs table
COMMENT ON TABLE playlist_songs IS 'Many-to-many relationship between playlists and songs';
COMMENT ON COLUMN playlist_songs.position IS 'Order of song within playlist (1-based)';
COMMENT ON COLUMN playlist_songs.created_at IS 'When this song was added to the playlist';
COMMENT ON COLUMN playlist_songs.added_by_client_id IS 'Client that added this song to the playlist';
COMMENT ON COLUMN playlist_songs.metadata IS 'Song-specific metadata within this playlist context';

-- Create indexes for playlist_songs table
CREATE INDEX idx_playlist_songs_playlist_id ON playlist_songs(playlist_id);
CREATE INDEX idx_playlist_songs_song_id ON playlist_songs(song_id);
CREATE INDEX idx_playlist_songs_position ON playlist_songs(playlist_id, position);
CREATE INDEX idx_playlist_songs_created_at ON playlist_songs(created_at);

-- Unique constraints for playlist_songs
CREATE UNIQUE INDEX idx_playlist_songs_unique_song ON playlist_songs(playlist_id, song_id);
CREATE UNIQUE INDEX idx_playlist_songs_unique_position ON playlist_songs(playlist_id, position);
