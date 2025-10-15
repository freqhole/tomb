-- Add 'add' event type to the check constraint for media_events table
-- This allows the new 'add' event type to be stored in the database

ALTER TABLE media_events DROP CONSTRAINT IF EXISTS chk_event_type;

ALTER TABLE media_events ADD CONSTRAINT chk_event_type CHECK (
    event_type::text = ANY (ARRAY[
        'play'::character varying,
        'pause'::character varying,
        'resume'::character varying,
        'seek'::character varying,
        'complete'::character varying,
        'stop'::character varying,
        'rate'::character varying,
        'favorite'::character varying,
        'unfavorite'::character varying,
        'tag'::character varying,
        'untag'::character varying,
        'add'::character varying,
        'share'::character varying,
        'view'::character varying,
        'thumbnail_click'::character varying,
        'playlist_add'::character varying,
        'playlist_remove'::character varying,
        'skip'::character varying,
        'repeat'::character varying,
        'shuffle'::character varying,
        'volume_change'::character varying,
        'quality_change'::character varying,
        'fullscreen'::character varying,
        'picture_in_picture'::character varying,
        'cast'::character varying,
        'upload'::character varying,
        'create_playlist'::character varying,
        'add_to_playlist'::character varying
    ]::text[])
);
