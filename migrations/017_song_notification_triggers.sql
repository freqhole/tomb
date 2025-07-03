-- Migration 017: Song notification triggers
-- Add notification triggers for song changes to enable real-time WebSocket updates
-- This will send notifications when songs are added, updated, or deleted

-- Function to send notifications for song changes
CREATE OR REPLACE FUNCTION notify_song_change()
RETURNS TRIGGER AS $$
DECLARE
    notification_payload JSONB;
    event_type TEXT;
    channel_name TEXT := 'media_blobs'; -- Use media_blobs channel for better client compatibility
BEGIN
    -- Determine event type based on the operation
    IF TG_OP = 'INSERT' THEN
        event_type := 'song.created';
    ELSIF TG_OP = 'UPDATE' THEN
        event_type := 'song.updated';
    ELSIF TG_OP = 'DELETE' THEN
        event_type := 'song.deleted';
    ELSE
        event_type := 'song.unknown';
    END IF;

    -- Build payload based on operation type
    IF TG_OP = 'DELETE' THEN
        notification_payload := jsonb_build_object(
            'event_type', event_type,
            'id', OLD.id,
            'title', OLD.title,
            'artist', OLD.artist,
            'media_blob_id', OLD.media_blob_id,
            'timestamp', NOW()
        );
    ELSE
        notification_payload := jsonb_build_object(
            'event_type', event_type,
            'id', NEW.id,
            'title', NEW.title,
            'artist', NEW.artist,
            'media_blob_id', NEW.media_blob_id,
            'album', NEW.album,
            'genre', NEW.genre,
            'timestamp', NOW()
        );
    END IF;

    -- Send the notification
    PERFORM pg_notify(channel_name, notification_payload::text);

    -- Return appropriate record based on operation
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for song changes
DROP TRIGGER IF EXISTS trigger_notify_song_insert ON songs;
DROP TRIGGER IF EXISTS trigger_notify_song_update ON songs;
DROP TRIGGER IF EXISTS trigger_notify_song_delete ON songs;

CREATE TRIGGER trigger_notify_song_insert
    AFTER INSERT ON songs
    FOR EACH ROW
    EXECUTE FUNCTION notify_song_change();

CREATE TRIGGER trigger_notify_song_update
    AFTER UPDATE ON songs
    FOR EACH ROW
    EXECUTE FUNCTION notify_song_change();

CREATE TRIGGER trigger_notify_song_delete
    AFTER DELETE ON songs
    FOR EACH ROW
    EXECUTE FUNCTION notify_song_change();

-- Add comments for documentation
COMMENT ON FUNCTION notify_song_change() IS 'Sends PostgreSQL notifications for song changes via NOTIFY/LISTEN';
COMMENT ON TRIGGER trigger_notify_song_insert ON songs IS 'Trigger notification when songs are inserted';
COMMENT ON TRIGGER trigger_notify_song_update ON songs IS 'Trigger notification when songs are updated';
COMMENT ON TRIGGER trigger_notify_song_delete ON songs IS 'Trigger notification when songs are deleted';
