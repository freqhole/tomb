//! cross-entity video queries (composing series/season/video reads that
//! don't belong to any single entity's own repository.rs)

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

use crate::response::GrimoireResponse;
use crate::video::entities::seasons::{self, VideoSeason};
use crate::video::entities::series::{self, VideoSeries};
use crate::video::entities::videos::{self, Video};

/// one season plus the videos that belong to it
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct SeasonWithVideos {
    pub season: VideoSeason,
    pub videos: Vec<Video>,
}

/// full series detail: the series itself, every season (each with its
/// videos), and any videos attached directly to the series with no season
/// (season-less docuseries episodes)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct SeriesDetail {
    pub series: VideoSeries,
    pub seasons: Vec<SeasonWithVideos>,
    pub unassigned_videos: Vec<Video>,
}

/// fetch a series along with every season (each populated with its videos)
/// and any season-less videos attached directly to the series - one call
/// instead of a series + N seasons + N video-list round trips.
pub async fn get_series_detail(series_id: &str) -> GrimoireResponse<SeriesDetail> {
    let series_response = series::get_video_series(series_id).await;
    if !series_response.success {
        return GrimoireResponse::failure(series_response.message, series_response.errors);
    }
    let series = series_response.data.expect("success response has data");

    let seasons_response = seasons::list_video_seasons(series_id).await;
    if !seasons_response.success {
        return GrimoireResponse::failure(seasons_response.message, seasons_response.errors);
    }
    let season_rows = seasons_response.data.expect("success response has data");

    let videos_response = videos::list_videos_by_series(series_id).await;
    if !videos_response.success {
        return GrimoireResponse::failure(videos_response.message, videos_response.errors);
    }
    let all_videos = videos_response.data.expect("success response has data");

    let mut seasons_with_videos = Vec::with_capacity(season_rows.len());
    for season in season_rows {
        let videos: Vec<Video> = all_videos
            .iter()
            .filter(|v| v.season_id.as_deref() == Some(season.id.as_str()))
            .cloned()
            .collect();
        seasons_with_videos.push(SeasonWithVideos { season, videos });
    }

    let unassigned_videos: Vec<Video> = all_videos
        .into_iter()
        .filter(|v| v.season_id.is_none())
        .collect();

    GrimoireResponse::success(
        "Series detail retrieved successfully",
        SeriesDetail {
            series,
            seasons: seasons_with_videos,
            unassigned_videos,
        },
    )
}
