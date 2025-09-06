-- Playlist Preferences and Ownership Migration
-- This migration adds support for:
-- 1. User preferences for playlists (favorites)
-- 2. Playlist ownership system

-- create user preferences for playlists
CREATE TABLE user_playlist_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    is_favorite BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, playlist_id)
);

-- create playlist ownership table
CREATE TABLE playlist_ownership (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(playlist_id) -- one owner per playlist
);

-- add comments for playlist preference table
COMMENT ON TABLE user_playlist_preferences IS 'per-user playlist favorites';
COMMENT ON COLUMN user_playlist_preferences.user_id IS 'user who set these preferences';
COMMENT ON COLUMN user_playlist_preferences.playlist_id IS 'playlist these preferences apply to';
COMMENT ON COLUMN user_playlist_preferences.is_favorite IS 'whether user marked this playlist as favorite';

-- add comments for playlist ownership table
COMMENT ON TABLE playlist_ownership IS 'tracks ownership of playlists by users';
COMMENT ON COLUMN playlist_ownership.playlist_id IS 'playlist that is owned';
COMMENT ON COLUMN playlist_ownership.owner_user_id IS 'user who owns this playlist';

-- create performance indexes for user playlist preferences
CREATE INDEX idx_user_playlist_preferences_user_id ON user_playlist_preferences(user_id);
CREATE INDEX idx_user_playlist_preferences_playlist_id ON user_playlist_preferences(playlist_id);
CREATE INDEX idx_user_playlist_preferences_is_favorite ON user_playlist_preferences(user_id, is_favorite) WHERE is_favorite = true;
CREATE INDEX idx_user_playlist_preferences_updated_at ON user_playlist_preferences(updated_at);

-- create performance indexes for playlist ownership
CREATE INDEX idx_playlist_ownership_owner ON playlist_ownership(owner_user_id);
CREATE INDEX idx_playlist_ownership_playlist ON playlist_ownership(playlist_id);

-- create helper function to upsert user playlist preferences
CREATE OR REPLACE FUNCTION upsert_user_playlist_preference(
    p_user_id UUID,
    p_playlist_id UUID,
    p_is_favorite BOOLEAN DEFAULT NULL
) RETURNS user_playlist_preferences AS $$
DECLARE
    result user_playlist_preferences;
BEGIN
    INSERT INTO user_playlist_preferences (user_id, playlist_id, is_favorite)
    VALUES (p_user_id, p_playlist_id, COALESCE(p_is_favorite, false))
    ON CONFLICT (user_id, playlist_id)
    DO UPDATE SET
        is_favorite = CASE WHEN p_is_favorite IS NOT NULL THEN p_is_favorite ELSE user_playlist_preferences.is_favorite END,
        updated_at = NOW()
    RETURNING * INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- create helper function to set playlist ownership
CREATE OR REPLACE FUNCTION set_playlist_owner(
    p_playlist_id UUID,
    p_owner_user_id UUID
) RETURNS playlist_ownership AS $$
DECLARE
    result playlist_ownership;
BEGIN
    INSERT INTO playlist_ownership (playlist_id, owner_user_id)
    VALUES (p_playlist_id, p_owner_user_id)
    ON CONFLICT (playlist_id)
    DO UPDATE SET owner_user_id = p_owner_user_id
    RETURNING * INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- create function to get playlists with user preferences and ownership
CREATE OR REPLACE FUNCTION get_playlists_with_user_context(p_user_id UUID)
RETURNS TABLE (
    id UUID,
    title TEXT,
    description TEXT,
    song_count BIGINT,
    total_duration INTERVAL,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    version BIGINT,
    user_is_favorite BOOLEAN,
    preference_updated_at TIMESTAMPTZ,
    is_owned_by_user BOOLEAN,
    owner_user_id UUID,
    ownership_created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT p.id,
           p.title,
           p.description,
           p.song_count,
           p.total_duration,
           p.created_at,
           p.updated_at,
           p.version,
           COALESCE(upp.is_favorite, false) as user_is_favorite,
           upp.updated_at as preference_updated_at,
           (po.owner_user_id = p_user_id) as is_owned_by_user,
           po.owner_user_id,
           po.created_at as ownership_created_at
    FROM playlists p
    LEFT JOIN user_playlist_preferences upp ON p.id = upp.playlist_id AND upp.user_id = p_user_id
    LEFT JOIN playlist_ownership po ON p.id = po.playlist_id
    ORDER BY p.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- create function to get user's owned playlists
CREATE OR REPLACE FUNCTION get_user_owned_playlists(p_user_id UUID)
RETURNS TABLE (
    id UUID,
    title TEXT,
    description TEXT,
    song_count BIGINT,
    total_duration INTERVAL,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    version BIGINT,
    ownership_created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT p.id,
           p.title,
           p.description,
           p.song_count,
           p.total_duration,
           p.created_at,
           p.updated_at,
           p.version,
           po.created_at as ownership_created_at
    FROM playlists p
    JOIN playlist_ownership po ON p.id = po.playlist_id
    WHERE po.owner_user_id = p_user_id
    ORDER BY po.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- create function to transfer playlist ownership (with validation)
CREATE OR REPLACE FUNCTION transfer_playlist_ownership(
    p_playlist_id UUID,
    p_from_user_id UUID,
    p_to_user_id UUID
) RETURNS playlist_ownership AS $$
DECLARE
    current_owner UUID;
    result playlist_ownership;
BEGIN
    -- check current ownership
    SELECT owner_user_id INTO current_owner
    FROM playlist_ownership
    WHERE playlist_id = p_playlist_id;

    -- validate that the requesting user is the current owner
    IF current_owner IS NULL THEN
        RAISE EXCEPTION 'playlist has no owner (playlist_id: %)', p_playlist_id;
    END IF;

    IF current_owner != p_from_user_id THEN
        RAISE EXCEPTION 'user % is not the owner of playlist %', p_from_user_id, p_playlist_id;
    END IF;

    -- verify target user exists
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_to_user_id) THEN
        RAISE EXCEPTION 'target user % does not exist', p_to_user_id;
    END IF;

    -- transfer ownership
    UPDATE playlist_ownership
    SET owner_user_id = p_to_user_id
    WHERE playlist_id = p_playlist_id
    RETURNING * INTO result;

    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- create function to bulk favorite all songs in a playlist
CREATE OR REPLACE FUNCTION bulk_favorite_playlist_songs(
    p_user_id UUID,
    p_playlist_id UUID,
    p_is_favorite BOOLEAN
) RETURNS SETOF user_song_preferences AS $$
DECLARE
    song_record RECORD;
    preference_record user_song_preferences;
BEGIN
    -- iterate through all songs in the playlist
    FOR song_record IN
        SELECT ps.song_id
        FROM playlist_songs ps
        WHERE ps.playlist_id = p_playlist_id
        ORDER BY ps.position
    LOOP
        -- upsert preference for each song
        SELECT * INTO preference_record
        FROM upsert_user_song_preference(p_user_id, song_record.song_id, p_is_favorite, NULL);

        RETURN NEXT preference_record;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- add comments for helper functions
COMMENT ON FUNCTION upsert_user_playlist_preference IS 'insert or update user playlist preferences';
COMMENT ON FUNCTION set_playlist_owner IS 'set or update playlist ownership';
COMMENT ON FUNCTION get_playlists_with_user_context IS 'get all playlists with user-specific preference and ownership data';
COMMENT ON FUNCTION get_user_owned_playlists IS 'get playlists owned by a specific user';
COMMENT ON FUNCTION transfer_playlist_ownership IS 'transfer playlist ownership between users with validation';
COMMENT ON FUNCTION bulk_favorite_playlist_songs IS 'bulk favorite or unfavorite all songs in a playlist for a user';
