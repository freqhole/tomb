//! video domain module
//!
//! provides the video entity hierarchy (series/season/video) plus the
//! generalized cross-domain tables (`entity_taxonz`, `playlist_itemz`,
//! `playback_progressz`) as they apply to video. mirrors the structure of
//! `crate::music` - business logic lives here, callers (server/cli) are
//! thin wrappers.

pub mod crud;
pub mod entities;
pub mod importer;

// series/season/video CRUD (create/get/list/update). deletes are exposed
// from `crud::delete` instead, since they cascade + clean up side tables.
pub use entities::seasons::{
    create_video_season, get_video_season, list_video_seasons, update_video_season,
    CreateVideoSeasonRequest, UpdateVideoSeasonRequest, VideoSeason,
};
pub use entities::series::{
    create_video_series, get_video_series, list_video_seriez, update_video_series,
    CreateVideoSeriesRequest, UpdateVideoSeriesRequest, VideoSeries,
};
pub use entities::videos::{
    create_video, get_video, list_videos_by_season, list_videos_by_series, list_videos_unattached,
    update_video, CreateVideoRequest, UpdateVideoRequest, Video,
};

// cascading delete + side-table cleanup
pub use crud::delete::{
    bulk_delete_videos, delete_video, delete_video_season, delete_video_series,
    BulkDeleteVideosResponse,
};

// bulk update
pub use crud::update::{update_videos, UpdateVideosRequest, UpdateVideosResult};

// cross-entity queries
pub use crud::query::{
    get_series_detail, query_video_seriez, query_videos, SeasonWithVideos, SeriesDetail,
    SeriesQueryResult, VideosQueryResult,
};

// generalized entity_taxonz / playlist_itemz / playback_progressz, as used by video
pub use crud::entity_taxonz::{
    add_entity_taxon, list_entity_taxons, remove_entity_taxon, EntityTaxonLink, VideoEntityType,
};
pub use crud::playback_progressz::{
    get_playback_progress, list_playback_progress_for_user, upsert_playback_progress,
    PlaybackProgress,
};
pub use crud::playlist_itemz::{
    add_playlist_item, list_playlist_items, remove_playlist_item, PlaylistItem,
};
