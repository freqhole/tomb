-- User Preferences Migration - Phase 1
-- This migration creates per-user preference tables while keeping existing
-- columns functional for backward compatibility

-- create user preferences for songs
CREATE TABLE user_song_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id UUID NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    is_favorite BOOLEAN DEFAULT false,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, song_id)
);

-- create user preferences for photos
CREATE TABLE user_photo_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    photo_id UUID NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
    is_favorite BOOLEAN DEFAULT false,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, photo_id)
);

-- create user preferences for videos
CREATE TABLE user_video_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    is_favorite BOOLEAN DEFAULT false,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, video_id)
);

-- add comments for user preference tables
COMMENT ON TABLE user_song_preferences IS 'per-user song favorites and ratings';
COMMENT ON COLUMN user_song_preferences.user_id IS 'user who set these preferences';
COMMENT ON COLUMN user_song_preferences.song_id IS 'song these preferences apply to';
COMMENT ON COLUMN user_song_preferences.is_favorite IS 'whether user marked this song as favorite';
COMMENT ON COLUMN user_song_preferences.rating IS 'user rating from 1-5 stars';

COMMENT ON TABLE user_photo_preferences IS 'per-user photo favorites and ratings';
COMMENT ON COLUMN user_photo_preferences.user_id IS 'user who set these preferences';
COMMENT ON COLUMN user_photo_preferences.photo_id IS 'photo these preferences apply to';
COMMENT ON COLUMN user_photo_preferences.is_favorite IS 'whether user marked this photo as favorite';
COMMENT ON COLUMN user_photo_preferences.rating IS 'user rating from 1-5 stars';

COMMENT ON TABLE user_video_preferences IS 'per-user video favorites and ratings';
COMMENT ON COLUMN user_video_preferences.user_id IS 'user who set these preferences';
COMMENT ON COLUMN user_video_preferences.video_id IS 'video these preferences apply to';
COMMENT ON COLUMN user_video_preferences.is_favorite IS 'whether user marked this video as favorite';
COMMENT ON COLUMN user_video_preferences.rating IS 'user rating from 1-5 stars';

-- create performance indexes for user song preferences
CREATE INDEX idx_user_song_preferences_user_id ON user_song_preferences(user_id);
CREATE INDEX idx_user_song_preferences_song_id ON user_song_preferences(song_id);
CREATE INDEX idx_user_song_preferences_is_favorite ON user_song_preferences(user_id, is_favorite) WHERE is_favorite = true;
CREATE INDEX idx_user_song_preferences_rating ON user_song_preferences(user_id, rating) WHERE rating IS NOT NULL;
CREATE INDEX idx_user_song_preferences_updated_at ON user_song_preferences(updated_at);

-- create performance indexes for user photo preferences
CREATE INDEX idx_user_photo_preferences_user_id ON user_photo_preferences(user_id);
CREATE INDEX idx_user_photo_preferences_photo_id ON user_photo_preferences(photo_id);
CREATE INDEX idx_user_photo_preferences_is_favorite ON user_photo_preferences(user_id, is_favorite) WHERE is_favorite = true;
CREATE INDEX idx_user_photo_preferences_rating ON user_photo_preferences(user_id, rating) WHERE rating IS NOT NULL;
CREATE INDEX idx_user_photo_preferences_updated_at ON user_photo_preferences(updated_at);

-- create performance indexes for user video preferences
CREATE INDEX idx_user_video_preferences_user_id ON user_video_preferences(user_id);
CREATE INDEX idx_user_video_preferences_video_id ON user_video_preferences(video_id);
CREATE INDEX idx_user_video_preferences_is_favorite ON user_video_preferences(user_id, is_favorite) WHERE is_favorite = true;
CREATE INDEX idx_user_video_preferences_rating ON user_video_preferences(user_id, rating) WHERE rating IS NOT NULL;
CREATE INDEX idx_user_video_preferences_updated_at ON user_video_preferences(updated_at);

-- create helper function to upsert user song preferences
CREATE OR REPLACE FUNCTION upsert_user_song_preference(
    p_user_id UUID,
    p_song_id UUID,
    p_is_favorite BOOLEAN DEFAULT NULL,
    p_rating INTEGER DEFAULT NULL
) RETURNS user_song_preferences AS $$
DECLARE
    result user_song_preferences;
BEGIN
    INSERT INTO user_song_preferences (user_id, song_id, is_favorite, rating)
    VALUES (p_user_id, p_song_id, COALESCE(p_is_favorite, false), p_rating)
    ON CONFLICT (user_id, song_id)
    DO UPDATE SET
        is_favorite = CASE WHEN p_is_favorite IS NOT NULL THEN p_is_favorite ELSE user_song_preferences.is_favorite END,
        rating = CASE WHEN p_rating IS NOT NULL THEN p_rating ELSE user_song_preferences.rating END,
        updated_at = NOW()
    RETURNING * INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- create helper function to upsert user photo preferences
CREATE OR REPLACE FUNCTION upsert_user_photo_preference(
    p_user_id UUID,
    p_photo_id UUID,
    p_is_favorite BOOLEAN DEFAULT NULL,
    p_rating INTEGER DEFAULT NULL
) RETURNS user_photo_preferences AS $$
DECLARE
    result user_photo_preferences;
BEGIN
    INSERT INTO user_photo_preferences (user_id, photo_id, is_favorite, rating)
    VALUES (p_user_id, p_photo_id, COALESCE(p_is_favorite, false), p_rating)
    ON CONFLICT (user_id, photo_id)
    DO UPDATE SET
        is_favorite = CASE WHEN p_is_favorite IS NOT NULL THEN p_is_favorite ELSE user_photo_preferences.is_favorite END,
        rating = CASE WHEN p_rating IS NOT NULL THEN p_rating ELSE user_photo_preferences.rating END,
        updated_at = NOW()
    RETURNING * INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- create helper function to upsert user video preferences
CREATE OR REPLACE FUNCTION upsert_user_video_preference(
    p_user_id UUID,
    p_video_id UUID,
    p_is_favorite BOOLEAN DEFAULT NULL,
    p_rating INTEGER DEFAULT NULL
) RETURNS user_video_preferences AS $$
DECLARE
    result user_video_preferences;
BEGIN
    INSERT INTO user_video_preferences (user_id, video_id, is_favorite, rating)
    VALUES (p_user_id, p_video_id, COALESCE(p_is_favorite, false), p_rating)
    ON CONFLICT (user_id, video_id)
    DO UPDATE SET
        is_favorite = CASE WHEN p_is_favorite IS NOT NULL THEN p_is_favorite ELSE user_video_preferences.is_favorite END,
        rating = CASE WHEN p_rating IS NOT NULL THEN p_rating ELSE user_video_preferences.rating END,
        updated_at = NOW()
    RETURNING * INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- create function to get songs with user preferences
CREATE OR REPLACE FUNCTION get_songs_with_user_preferences(p_user_id UUID)
RETURNS TABLE (
    id UUID,
    media_blob_id VARCHAR(16),
    thumbnail_blob_id VARCHAR(16),
    waveform_blob_id VARCHAR(16),
    title TEXT,
    artist TEXT,
    album TEXT,
    album_artist TEXT,
    track_number INTEGER,
    disc_number INTEGER,
    duration INTERVAL,
    genre TEXT,
    year INTEGER,
    bpm INTEGER,
    key_signature TEXT,
    tags TEXT[],
    metadata JSONB,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    version BIGINT,
    user_is_favorite BOOLEAN,
    user_rating INTEGER,
    preference_updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT s.id,
           s.media_blob_id,
           s.thumbnail_blob_id,
           s.waveform_blob_id,
           s.title,
           s.artist,
           s.album,
           s.album_artist,
           s.track_number,
           s.disc_number,
           s.duration,
           s.genre,
           s.year,
           s.bpm,
           s.key_signature,
           s.tags,
           s.metadata,
           s.deleted_at,
           s.deleted_by,
           s.created_at,
           s.updated_at,
           s.version,
           COALESCE(up.is_favorite, false) as user_is_favorite,
           up.rating as user_rating,
           up.updated_at as preference_updated_at
    FROM songs s
    LEFT JOIN user_song_preferences up ON s.id = up.song_id AND up.user_id = p_user_id
    WHERE s.deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql;

-- create function to get user's album summary with their preferences
CREATE OR REPLACE FUNCTION get_user_album_summary(p_user_id UUID)
RETURNS TABLE (
    album TEXT,
    album_artist TEXT,
    artist TEXT,
    track_count BIGINT,
    disc_count BIGINT,
    total_duration INTERVAL,
    year INTEGER,
    genres TEXT,
    user_avg_rating NUMERIC,
    user_favorite_count BIGINT,
    first_added TIMESTAMPTZ,
    last_modified TIMESTAMPTZ,
    album_thumbnail_id VARCHAR(16)
) AS $$
BEGIN
    RETURN QUERY
    SELECT s.album,
           s.album_artist,
           CASE
               WHEN count(DISTINCT s.artist) = 1 THEN min(s.artist)
               WHEN s.album_artist = 'Various Artists' THEN s.album_artist
               WHEN count(DISTINCT s.artist) <= 3 THEN string_agg(DISTINCT s.artist, ', ' ORDER BY s.artist)
               ELSE string_agg(DISTINCT s.artist, ', ' ORDER BY s.artist) || ' and others'
           END AS artist,
           count(*) AS track_count,
           count(DISTINCT s.disc_number) AS disc_count,
           sum(s.duration) AS total_duration,
           min(s.year) AS year,
           string_agg(DISTINCT s.genre, ', ') AS genres,
           avg(up.rating) FILTER (WHERE up.rating IS NOT NULL) AS user_avg_rating,
           count(*) FILTER (WHERE up.is_favorite = true) AS user_favorite_count,
           min(s.created_at) AS first_added,
           max(s.updated_at) AS last_modified,
           (SELECT s2.thumbnail_blob_id
            FROM songs s2
            WHERE s2.album = s.album
              AND (s2.album_artist = s.album_artist OR (s2.album_artist IS NULL AND s.album_artist IS NULL))
              AND s2.thumbnail_blob_id IS NOT NULL
              AND s2.deleted_at IS NULL
            ORDER BY s2.disc_number, s2.track_number
            LIMIT 1) AS album_thumbnail_id
    FROM songs s
    LEFT JOIN user_song_preferences up ON s.id = up.song_id AND up.user_id = p_user_id
    WHERE s.deleted_at IS NULL
    GROUP BY s.album, s.album_artist
    HAVING s.album IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- add comments for helper functions
COMMENT ON FUNCTION upsert_user_song_preference IS 'insert or update user song preferences, allowing partial updates';
COMMENT ON FUNCTION upsert_user_photo_preference IS 'insert or update user photo preferences, allowing partial updates';
COMMENT ON FUNCTION upsert_user_video_preference IS 'insert or update user video preferences, allowing partial updates';
COMMENT ON FUNCTION get_songs_with_user_preferences IS 'get all songs with user-specific preference data';
COMMENT ON FUNCTION get_user_album_summary IS 'get album summary with user-specific ratings and favorites';
