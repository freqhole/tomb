//! video module
//! handles the unified video entity's domain logic

mod models;
mod repository;

pub use models::{
    default_album_title, is_music_content_type, CreateVideoRequest, UpdateVideoRequest, Video,
    VideoRendition, VideoWithMetadata, MUSIC_CONTENT_TYPES, VIDEO_CONTENT_TYPES,
};
pub use repository::{
    create_video, delete_video, get_video, get_video_with_metadata, list_recently_added_videos,
    list_unassigned_videos, list_video_extras, list_videos_by_album, list_videos_by_artist,
    list_videos_by_season, list_videos_by_series, list_videos_by_taxon_value,
    list_videos_unattached, update_video,
};
