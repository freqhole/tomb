-- PostgreSQL NOTIFY triggers for real-time notifications
-- Provides PostgreSQL NOTIFY/LISTEN integration for media blob changes

-- Function to send notifications for media blob changes
CREATE OR REPLACE FUNCTION notify_media_blob_change()
RETURNS TRIGGER AS $$
DECLARE
    notification_payload JSONB;
    event_type TEXT;
    channel_name TEXT := 'media_blobs';
BEGIN
    -- Determine event type based on trigger operation
    IF TG_OP = 'INSERT' then
        event_type := 'media_blob.created';
        notification_payload := jsonb_build_object(
            'event_type', event_type,
            'blob_id', NEW.id,
            'sha256', NEW.sha256,
            'filename', COALESCE(NEW.metadata->>'filename', 'unknown'),
            'mime_type', NEW.mime,
            'size_bytes', NEW.size,
            'source_client_id', NEW.source_client_id,
            'created_at', NEW.created_at,
            'metadata', NEW.metadata
        );
    ELSIF TG_OP = 'UPDATE' then
        event_type := 'media_blob.updated';
        notification_payload := jsonb_build_object(
            'event_type', event_type,
            'blob_id', NEW.id,
            'sha256', NEW.sha256,
            'filename', COALESCE(NEW.metadata->>'filename', 'unknown'),
            'mime_type', NEW.mime,
            'size_bytes', NEW.size,
            'source_client_id', NEW.source_client_id,
            'updated_at', NEW.updated_at,
            'metadata', NEW.metadata,
            'changes', jsonb_build_object(
                'metadata_changed', (OLD.metadata IS DISTINCT FROM NEW.metadata),
                'mime_changed', (OLD.mime IS DISTINCT FROM NEW.mime),
                'size_changed', (OLD.size IS DISTINCT FROM NEW.size)
            )
        );
    ELSIF TG_OP = 'DELETE' then
        event_type := 'media_blob.deleted';
        notification_payload := jsonb_build_object(
            'event_type', event_type,
            'blob_id', OLD.id,
            'sha256', OLD.sha256,
            'filename', COALESCE(OLD.metadata->>'filename', 'unknown'),
            'mime_type', OLD.mime,
            'size_bytes', OLD.size,
            'source_client_id', OLD.source_client_id,
            'deleted_at', now()
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

-- Create triggers for media blob changes
DROP TRIGGER IF EXISTS trigger_notify_media_blob_insert ON media_blobs;
DROP TRIGGER IF EXISTS trigger_notify_media_blob_update ON media_blobs;
DROP TRIGGER IF EXISTS trigger_notify_media_blob_delete ON media_blobs;

CREATE TRIGGER trigger_notify_media_blob_insert
    AFTER INSERT ON media_blobs
    FOR EACH ROW
    EXECUTE FUNCTION notify_media_blob_change();

CREATE TRIGGER trigger_notify_media_blob_update
    AFTER UPDATE ON media_blobs
    FOR EACH ROW
    EXECUTE FUNCTION notify_media_blob_change();

CREATE TRIGGER trigger_notify_media_blob_delete
    AFTER DELETE ON media_blobs
    FOR EACH ROW
    EXECUTE FUNCTION notify_media_blob_change();

-- Function to send notifications for thumbnail job changes
CREATE OR REPLACE FUNCTION notify_thumbnail_job_change()
RETURNS TRIGGER AS $$
DECLARE
    notification_payload JSONB;
    event_type TEXT;
    channel_name TEXT := 'thumbnail_jobs';
BEGIN
    -- Determine event type based on trigger operation and status
    IF TG_OP = 'INSERT' then
        event_type := 'thumbnail_job.created';
        notification_payload := jsonb_build_object(
            'event_type', event_type,
            'job_id', NEW.id,
            'media_blob_id', NEW.media_blob_id,
            'status', NEW.status,
            'priority', NEW.priority,
            'dimensions', jsonb_build_object(
                'width', NEW.width,
                'height', NEW.height
            ),
            'created_at', NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' then
        -- Determine specific event type based on status change
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            CASE NEW.status
                WHEN 'completed' THEN
                    event_type := 'thumbnail_job.completed';
                WHEN 'failed' THEN
                    event_type := 'thumbnail_job.failed';
                WHEN 'processing' THEN
                    event_type := 'thumbnail_job.started';
                ELSE
                    event_type := 'thumbnail_job.updated';
            END CASE;
        ELSE
            event_type := 'thumbnail_job.updated';
        END IF;

        notification_payload := jsonb_build_object(
            'event_type', event_type,
            'job_id', NEW.id,
            'media_blob_id', NEW.media_blob_id,
            'status', NEW.status,
            'priority', NEW.priority,
            'dimensions', jsonb_build_object(
                'width', NEW.width,
                'height', NEW.height
            ),
            'updated_at', NEW.updated_at,
            'processing_time_ms', CASE
                WHEN NEW.completed_at IS NOT NULL AND NEW.started_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at)) * 1000
                ELSE NULL
            END,
            'error_message', NEW.error_message
        );
    END IF;

    -- Send the notification
    PERFORM pg_notify(channel_name, notification_payload::text);

    -- Return appropriate record
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for thumbnail job changes
DROP TRIGGER IF EXISTS trigger_notify_thumbnail_job_insert ON thumbnail_jobs;
DROP TRIGGER IF EXISTS trigger_notify_thumbnail_job_update ON thumbnail_jobs;

CREATE TRIGGER trigger_notify_thumbnail_job_insert
    AFTER INSERT ON thumbnail_jobs
    FOR EACH ROW
    EXECUTE FUNCTION notify_thumbnail_job_change();

CREATE TRIGGER trigger_notify_thumbnail_job_update
    AFTER UPDATE ON thumbnail_jobs
    FOR EACH ROW
    EXECUTE FUNCTION notify_thumbnail_job_change();

-- Add comments for documentation
COMMENT ON FUNCTION notify_media_blob_change() IS 'Sends PostgreSQL notifications for media blob changes via NOTIFY/LISTEN';
COMMENT ON FUNCTION notify_thumbnail_job_change() IS 'Sends PostgreSQL notifications for thumbnail job status changes via NOTIFY/LISTEN';

-- Test function to manually trigger notifications (useful for development)
CREATE OR REPLACE FUNCTION test_notification(channel_name TEXT, test_payload JSONB)
RETURNS VOID AS $$
BEGIN
    PERFORM pg_notify(channel_name, test_payload::text);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION test_notification(TEXT, JSONB) IS 'Test function to manually send notifications for development and debugging';
