//! video module
//! handles the unified video entity's domain logic

mod models;
mod repository;

pub use models::{CreateVideoRequest, UpdateVideoRequest, Video, VideoWithMetadata};
pub use repository::{
    create_video, delete_video, get_video, get_video_with_metadata, list_recently_added_videos,
    list_unassigned_videos, list_videos_by_season, list_videos_by_series,
    list_videos_by_taxon_value, list_videos_unattached, update_video,
};
