-- Migration 018: Fix song notification channel
-- Update the song notification trigger to use the correct music_notifications channel
-- instead of media_blobs for consistency with the rest of the notification system

-- Update the notification function to use the correct channel
CREATE OR REPLACE FUNCTION notify_song_change()
RETURNS TRIGGER AS $$
DECLARE
    notification_payload JSONB;
    event_type TEXT;
    channel_name TEXT := 'music_notifications'; -- Use music_notifications channel for consistency
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

-- Update function comment
COMMENT ON FUNCTION notify_song_change() IS 'Sends PostgreSQL notifications for song changes via music_notifications channel';
