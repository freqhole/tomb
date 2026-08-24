//! video module
//! handles the unified video entity's domain logic

mod models;
mod repository;

pub use models::{CreateVideoRequest, UpdateVideoRequest, Video, VideoWithMetadata};
pub use repository::{
    create_video, delete_video, get_video, get_video_with_metadata, list_videos_by_season,
    list_videos_by_series, list_videos_unattached, update_video,
};
