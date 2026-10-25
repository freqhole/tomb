//! video season module
//! handles video season domain logic

mod models;
mod repository;

pub use models::{CreateVideoSeasonRequest, UpdateVideoSeasonRequest, VideoSeason};
pub use repository::{
    create_video_season, delete_video_season, find_or_create_video_season,
    find_video_season_by_number, get_video_season, list_video_seasons, merge_video_season,
    update_video_season,
};
