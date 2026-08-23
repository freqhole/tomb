//! video operations CLI commands
//!
//! uses offal dispatch for all routes, mirroring the music domain's
//! plumbing style.

use crate::plumbing::dispatch::dispatch_to_offal;
use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::music::crud::QueryParams;
use serde_json::json;

mod playlist_items;
mod taxon_links;

pub use playlist_items::PlaylistItemsAction;
pub use taxon_links::TaxonLinksAction;

#[derive(Subcommand)]
#[allow(clippy::large_enum_variant)]
pub enum VideoAction {
    /// query video series with filters and sorting
    QuerySeries {
        #[command(flatten)]
        params: QueryParams,
    },
    /// get a video series by id
    GetSeries {
        #[arg(long)]
        id: String,
    },
    /// create a new video series
    CreateSeries {
        #[arg(long)]
        title: String,
        #[arg(long)]
        description: Option<String>,
        #[arg(long)]
        poster_blob_id: Option<String>,
    },
    /// update a video series
    UpdateSeries {
        #[arg(long)]
        id: String,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long)]
        poster_blob_id: Option<String>,
    },
    /// delete a video series
    DeleteSeries {
        #[arg(long)]
        id: String,
    },

    /// list seasons for a series
    ListSeasons {
        #[arg(long)]
        series_id: String,
    },
    /// get a video season by id
    GetSeason {
        #[arg(long)]
        id: String,
    },
    /// create a new video season
    CreateSeason {
        #[arg(long)]
        series_id: String,
        #[arg(long)]
        season_number: i64,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long)]
        poster_blob_id: Option<String>,
    },
    /// update a video season
    UpdateSeason {
        #[arg(long)]
        id: String,
        #[arg(long)]
        season_number: Option<i64>,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long)]
        poster_blob_id: Option<String>,
    },
    /// delete a video season
    DeleteSeason {
        #[arg(long)]
        id: String,
    },

    /// query videos with filters and sorting
    QueryVideos {
        #[command(flatten)]
        params: QueryParams,
        /// filter to videos belonging to this series
        #[arg(long)]
        series_id: Option<String>,
        /// filter to videos belonging to this season
        #[arg(long)]
        season_id: Option<String>,
        /// filter to standalone videos with no series/season
        #[arg(long)]
        unassigned: bool,
    },
    /// get a video by id
    GetVideo {
        #[arg(long)]
        id: String,
    },
    /// bulk-update videos
    UpdateVideos {
        /// video ids to update (comma-separated)
        #[arg(long, value_delimiter = ',')]
        video_ids: Vec<String>,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long)]
        episode_number: Option<i64>,
        #[arg(long)]
        series_id: Option<String>,
        #[arg(long)]
        season_id: Option<String>,
        #[arg(long)]
        poster_blob_id: Option<String>,
        #[arg(long)]
        duration_seconds: Option<f64>,
        #[arg(long)]
        release_date: Option<String>,
    },
    /// delete a video
    DeleteVideo {
        #[arg(long)]
        id: String,
    },
    /// bulk-delete videos
    BulkDeleteVideos {
        /// video ids to delete (comma-separated)
        #[arg(long, value_delimiter = ',')]
        video_ids: Vec<String>,
    },

    /// generic cross-entity taxon links (series/season/video <-> taxon)
    TaxonLinks {
        #[command(subcommand)]
        action: TaxonLinksAction,
    },
    /// generic cross-entity playlist items (mixed-kind playlists)
    PlaylistItems {
        #[command(subcommand)]
        action: PlaylistItemsAction,
    },
}

/// handle video commands
pub async fn handle_command(action: VideoAction) -> CommandOutput<serde_json::Value> {
    match action {
        VideoAction::QuerySeries { params } => {
            dispatch_to_offal(
                "/api/video/series/query",
                serde_json::to_value(params).unwrap(),
            )
            .await
        }
        VideoAction::GetSeries { id } => {
            dispatch_to_offal("/api/video/series/get", json!({ "id": id })).await
        }
        VideoAction::CreateSeries {
            title,
            description,
            poster_blob_id,
        } => {
            dispatch_to_offal(
                "/api/video/series",
                json!({
                    "title": title,
                    "description": description,
                    "poster_blob_id": poster_blob_id,
                }),
            )
            .await
        }
        VideoAction::UpdateSeries {
            id,
            title,
            description,
            poster_blob_id,
        } => {
            dispatch_to_offal(
                "/api/video/series/update",
                json!({
                    "id": id,
                    "title": title,
                    "description": description,
                    "poster_blob_id": poster_blob_id,
                }),
            )
            .await
        }
        VideoAction::DeleteSeries { id } => {
            dispatch_to_offal("/api/video/series/delete", json!({ "id": id })).await
        }

        VideoAction::ListSeasons { series_id } => {
            dispatch_to_offal("/api/video/seasons/list", json!({ "series_id": series_id })).await
        }
        VideoAction::GetSeason { id } => {
            dispatch_to_offal("/api/video/seasons/get", json!({ "id": id })).await
        }
        VideoAction::CreateSeason {
            series_id,
            season_number,
            title,
            description,
            poster_blob_id,
        } => {
            dispatch_to_offal(
                "/api/video/seasons",
                json!({
                    "series_id": series_id,
                    "season_number": season_number,
                    "title": title,
                    "description": description,
                    "poster_blob_id": poster_blob_id,
                }),
            )
            .await
        }
        VideoAction::UpdateSeason {
            id,
            season_number,
            title,
            description,
            poster_blob_id,
        } => {
            dispatch_to_offal(
                "/api/video/seasons/update",
                json!({
                    "id": id,
                    "season_number": season_number,
                    "title": title,
                    "description": description,
                    "poster_blob_id": poster_blob_id,
                }),
            )
            .await
        }
        VideoAction::DeleteSeason { id } => {
            dispatch_to_offal("/api/video/seasons/delete", json!({ "id": id })).await
        }

        VideoAction::QueryVideos {
            params,
            series_id,
            season_id,
            unassigned,
        } => {
            let mut body = serde_json::to_value(params).unwrap();
            body["series_id"] = json!(series_id);
            body["season_id"] = json!(season_id);
            body["unassigned"] = json!(unassigned);
            dispatch_to_offal("/api/video/videos/query", body).await
        }
        VideoAction::GetVideo { id } => {
            dispatch_to_offal("/api/video/videos/get", json!({ "id": id })).await
        }
        VideoAction::UpdateVideos {
            video_ids,
            title,
            description,
            episode_number,
            series_id,
            season_id,
            poster_blob_id,
            duration_seconds,
            release_date,
        } => {
            dispatch_to_offal(
                "/api/video/videos/update",
                json!({
                    "video_ids": video_ids,
                    "title": title,
                    "description": description,
                    "episode_number": episode_number,
                    "series_id": series_id,
                    "season_id": season_id,
                    "poster_blob_id": poster_blob_id,
                    "duration_seconds": duration_seconds,
                    "release_date": release_date,
                }),
            )
            .await
        }
        VideoAction::DeleteVideo { id } => {
            dispatch_to_offal("/api/video/videos/delete", json!({ "id": id })).await
        }
        VideoAction::BulkDeleteVideos { video_ids } => {
            dispatch_to_offal(
                "/api/video/videos/bulk-delete",
                json!({ "video_ids": video_ids }),
            )
            .await
        }

        VideoAction::TaxonLinks { action } => taxon_links::handle_command(action).await,
        VideoAction::PlaylistItems { action } => playlist_items::handle_command(action).await,
    }
}
