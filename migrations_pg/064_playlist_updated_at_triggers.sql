-- Auto-update playlist updated_at triggers
-- Migration: 064_playlist_updated_at_triggers.sql

-- Note: update_updated_at_column() function already exists from other migrations

-- Trigger for direct playlist updates
DROP TRIGGER IF EXISTS trigger_playlists_updated_at ON playlists;
CREATE TRIGGER trigger_playlists_updated_at
    BEFORE UPDATE ON playlists
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to update playlist updated_at when songs are added/removed/reordered
CREATE OR REPLACE FUNCTION update_playlist_updated_at_on_songs_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Update the playlist's updated_at when playlist_songs table changes
    IF TG_OP = 'DELETE' THEN
        UPDATE playlists
        SET updated_at = NOW()
        WHERE id = OLD.playlist_id AND deleted_at IS NULL;
        RETURN OLD;
    ELSE
        UPDATE playlists
        SET updated_at = NOW()
        WHERE id = NEW.playlist_id AND deleted_at IS NULL;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Triggers for playlist_songs changes
DROP TRIGGER IF EXISTS trigger_playlist_songs_insert ON playlist_songs;
CREATE TRIGGER trigger_playlist_songs_insert
    AFTER INSERT ON playlist_songs
    FOR EACH ROW
    EXECUTE FUNCTION update_playlist_updated_at_on_songs_change();

DROP TRIGGER IF EXISTS trigger_playlist_songs_update ON playlist_songs;
CREATE TRIGGER trigger_playlist_songs_update
    AFTER UPDATE ON playlist_songs
    FOR EACH ROW
    EXECUTE FUNCTION update_playlist_updated_at_on_songs_change();

DROP TRIGGER IF EXISTS trigger_playlist_songs_delete ON playlist_songs;
CREATE TRIGGER trigger_playlist_songs_delete
    AFTER DELETE ON playlist_songs
    FOR EACH ROW
    EXECUTE FUNCTION update_playlist_updated_at_on_songs_change();

-- Comments for documentation
COMMENT ON FUNCTION update_playlist_updated_at_on_songs_change() IS 'Function to update playlist updated_at when songs are added, removed, or reordered';
COMMENT ON TRIGGER trigger_playlists_updated_at ON playlists IS 'Auto-update playlist updated_at on direct playlist changes';
COMMENT ON TRIGGER trigger_playlist_songs_insert ON playlist_songs IS 'Update playlist updated_at when songs are added';
COMMENT ON TRIGGER trigger_playlist_songs_update ON playlist_songs IS 'Update playlist updated_at when song positions change';
COMMENT ON TRIGGER trigger_playlist_songs_delete ON playlist_songs IS 'Update playlist updated_at when songs are removed';
