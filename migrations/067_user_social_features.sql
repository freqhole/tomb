-- Migration: 067_user_social_features.sql
-- Add user favorites, ratings, and social features for the social feed

-- Add server owner designation to users table (only if it doesn't exist)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'users' AND column_name = 'is_owner') THEN
        ALTER TABLE users ADD COLUMN is_owner BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Mark oldest admin as server owner
UPDATE users SET is_owner = TRUE
WHERE role = 'admin'
AND id = (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1)
AND (is_owner IS NULL OR is_owner IS NOT TRUE); -- only update if not already set

-- Create user_favorites table for extended favorites system
CREATE TABLE IF NOT EXISTS user_favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL, -- loose reference to users.id
    domain_type VARCHAR(20) NOT NULL, -- song, album, playlist, artist, genre
    domain_ids TEXT[] NOT NULL, -- array of row IDs (song.id, playlist.id, etc)
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, domain_type, domain_ids)
);

-- Add indexes for user_favorites
CREATE INDEX IF NOT EXISTS idx_user_favorites_user_id ON user_favorites (user_id);
CREATE INDEX IF NOT EXISTS idx_user_favorites_domain ON user_favorites (domain_type, domain_ids);
CREATE INDEX IF NOT EXISTS idx_user_favorites_created_at ON user_favorites (created_at DESC);

-- Create user_ratings table for extended ratings system
CREATE TABLE IF NOT EXISTS user_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL, -- loose reference to users.id
    domain_type VARCHAR(20) NOT NULL,
    domain_ids TEXT[] NOT NULL, -- array of row IDs (mixed types: song SHA, playlist UUID)
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, domain_type, domain_ids)
);

-- Add indexes for user_ratings
CREATE INDEX IF NOT EXISTS idx_user_ratings_user_id ON user_ratings (user_id);
CREATE INDEX IF NOT EXISTS idx_user_ratings_domain ON user_ratings (domain_type, domain_ids);
CREATE INDEX IF NOT EXISTS idx_user_ratings_rating ON user_ratings (rating DESC);
CREATE INDEX IF NOT EXISTS idx_user_ratings_created_at ON user_ratings (created_at DESC);

-- Add domain_type constraint for favorites and ratings (only if tables were created)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_favorites') THEN
        ALTER TABLE user_favorites DROP CONSTRAINT IF EXISTS chk_favorites_domain_type;
        ALTER TABLE user_favorites ADD CONSTRAINT chk_favorites_domain_type
            CHECK (domain_type IN ('song', 'album', 'artist', 'genre', 'playlist'));
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_ratings') THEN
        ALTER TABLE user_ratings DROP CONSTRAINT IF EXISTS chk_ratings_domain_type;
        ALTER TABLE user_ratings ADD CONSTRAINT chk_ratings_domain_type
            CHECK (domain_type IN ('song', 'album', 'artist', 'genre', 'playlist'));
    END IF;
END $$;

-- Create function to safely get username for analytics queries
CREATE OR REPLACE FUNCTION get_username_safe(user_uuid UUID)
RETURNS TEXT AS $$
BEGIN
    RETURN COALESCE(
        (SELECT username FROM users WHERE id = user_uuid),
        'unknown user'
    );
END;
$$ LANGUAGE plpgsql;

-- Create function to safely get song title for analytics queries
CREATE OR REPLACE FUNCTION get_song_title_safe(song_uuid UUID)
RETURNS TEXT AS $$
BEGIN
    RETURN COALESCE(
        (SELECT title FROM songs WHERE id = song_uuid),
        'deleted song'
    );
END;
$$ LANGUAGE plpgsql;

-- Create function to safely get playlist title for analytics queries
CREATE OR REPLACE FUNCTION get_playlist_title_safe(playlist_uuid UUID)
RETURNS TEXT AS $$
BEGIN
    RETURN COALESCE(
        (SELECT title FROM playlists WHERE id = playlist_uuid AND deleted_at IS NULL),
        'deleted playlist'
    );
END;
$$ LANGUAGE plpgsql;

-- Comments explaining the new features
COMMENT ON COLUMN users.is_owner IS 'Marks server owners/administrators for attribution in social feed';
COMMENT ON TABLE user_favorites IS 'Extended favorites system supporting all content types with loose coupling';
COMMENT ON TABLE user_ratings IS 'Extended ratings system (1-5 stars) for all content types with loose coupling';
