//! video series module
//! handles video series domain logic

mod models;
mod repository;

pub use models::{CreateVideoSeriesRequest, UpdateVideoSeriesRequest, VideoSeries};
pub use repository::{
    create_video_series, delete_video_series, find_or_create_video_series,
    find_video_series_by_title, get_video_series, list_video_seriez, update_video_series,
};
