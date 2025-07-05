-- Add Full-Text Search indexes and functions for songs and playlists
-- This migration adds tsvector columns and GIN indexes for efficient full-text search

-- Add tsvector columns for full-text search
ALTER TABLE songs ADD COLUMN search_vector tsvector;
ALTER TABLE playlists ADD COLUMN search_vector tsvector;

-- Create GIN indexes for full-text search
CREATE INDEX idx_songs_search_vector ON songs USING gin(search_vector);
CREATE INDEX idx_playlists_search_vector ON playlists USING gin(search_vector);

-- Create function to recursively extract all text from JSONB
CREATE OR REPLACE FUNCTION extract_jsonb_text(json_data JSONB) RETURNS TEXT AS $$
DECLARE
    result TEXT := '';
    rec RECORD;
    val TEXT;
BEGIN
    -- Handle null input
    IF json_data IS NULL THEN
        RETURN '';
    END IF;

    -- Handle different JSONB types
    CASE jsonb_typeof(json_data)
        WHEN 'object' THEN
            -- Recursively extract from all object values
            FOR rec IN SELECT * FROM jsonb_each(json_data) LOOP
                result := result || ' ' || extract_jsonb_text(rec.value);
            END LOOP;
        WHEN 'array' THEN
            -- Recursively extract from all array elements
            FOR rec IN SELECT * FROM jsonb_array_elements(json_data) LOOP
                result := result || ' ' || extract_jsonb_text(rec.value);
            END LOOP;
        WHEN 'string' THEN
            -- Extract string value
            result := json_data #>> '{}';
        WHEN 'number' THEN
            -- Convert numbers to searchable text
            result := json_data #>> '{}';
        WHEN 'boolean' THEN
            -- Convert booleans to searchable text
            result := json_data #>> '{}';
        ELSE
            -- Skip null and other types
            result := '';
    END CASE;

    RETURN trim(result);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create function to update song search vector
CREATE OR REPLACE FUNCTION update_song_search_vector() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.artist, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(NEW.album, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(NEW.album_artist, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(NEW.genre, '')), 'C') ||
        setweight(to_tsvector('english', array_to_string(NEW.tags, ' ')), 'C') ||
        setweight(to_tsvector('english', coalesce(NEW.key_signature, '')), 'D') ||
        setweight(to_tsvector('english', coalesce(extract_jsonb_text(NEW.metadata), '')), 'D');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic song search vector updates
CREATE TRIGGER trigger_songs_search_vector_update
    BEFORE INSERT OR UPDATE ON songs
    FOR EACH ROW
    EXECUTE FUNCTION update_song_search_vector();

-- Create function to update playlist search vector
CREATE OR REPLACE FUNCTION update_playlist_search_vector() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(extract_jsonb_text(NEW.metadata), '')), 'D');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic playlist search vector updates
CREATE TRIGGER trigger_playlists_search_vector_update
    BEFORE INSERT OR UPDATE ON playlists
    FOR EACH ROW
    EXECUTE FUNCTION update_playlist_search_vector();

-- Populate existing data with search vectors
UPDATE songs SET search_vector =
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(artist, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(album, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(album_artist, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(genre, '')), 'C') ||
    setweight(to_tsvector('english', array_to_string(tags, ' ')), 'C') ||
    setweight(to_tsvector('english', coalesce(key_signature, '')), 'D') ||
    setweight(to_tsvector('english', coalesce(extract_jsonb_text(metadata), '')), 'D');

UPDATE playlists SET search_vector =
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(extract_jsonb_text(metadata), '')), 'D');

-- Add comments for documentation
COMMENT ON COLUMN songs.search_vector IS 'Full-text search vector with weighted content: A=title, B=artist/album, C=genre/tags, D=metadata';
COMMENT ON COLUMN playlists.search_vector IS 'Full-text search vector with weighted content: A=title, B=description, D=metadata';
COMMENT ON FUNCTION extract_jsonb_text(JSONB) IS 'Recursively extracts all text values from JSONB for full-text search indexing';
COMMENT ON FUNCTION update_song_search_vector() IS 'Trigger function to automatically update song search vectors';
COMMENT ON FUNCTION update_playlist_search_vector() IS 'Trigger function to automatically update playlist search vectors';
