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
pub mod scanner;
pub mod search;

// directory scanning entry point (mirrors `crate::music::scan_directory`)
pub use scanner::scan_directory;

// series/season/video CRUD (create/get/list/update). deletes are exposed
// from `crud::delete` instead, since they cascade + clean up side tables.
pub use entities::seasons::{
    create_video_season, find_or_create_video_season, find_video_season_by_number,
    get_video_season, list_video_seasons, update_video_season, CreateVideoSeasonRequest,
    UpdateVideoSeasonRequest, VideoSeason,
};
pub use entities::series::{
    create_video_series, find_or_create_video_series, find_video_series_by_title,
    get_video_series, list_video_seriez, update_video_series, CreateVideoSeriesRequest,
    UpdateVideoSeriesRequest, VideoSeries,
};
pub use entities::videos::{
    create_video, get_video, get_video_with_metadata, list_recently_added_videos,
    list_unassigned_videos, list_videos_by_season, list_videos_by_series,
    list_videos_by_taxon_value, list_videos_unattached, update_video, CreateVideoRequest,
    UpdateVideoRequest, Video, VideoWithMetadata,
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
pub use crud::entity_imagez::{
    add_entity_image, list_entity_images, remove_entity_image, set_primary_entity_image,
};
pub use crud::entity_tagz::{
    add_entities_tags, add_entity_tag, apply_directory_tags_for_entity_file, get_entities_tags,
    list_entity_tags, list_entity_type_tags, remove_entities_tags, remove_entity_tag,
    EntityTagCount, EntityTagLink,
};
pub use crud::entity_taxonz::{
    add_entity_taxon, list_entity_taxons, remove_entity_taxon, EntityTaxonLink, VideoEntityType,
};
pub use crud::entity_urlz::{add_entity_url, list_entity_urls, remove_entity_url};
pub use crud::playback_progressz::{
    get_playback_progress, list_playback_progress_for_user, upsert_playback_progress,
    PlaybackProgress,
};
// generalized playlist items now live in `crate::playlists` (domain-neutral,
// since songs can be playlist members too, not just video entities).

// full-text search
pub use search::{
    get_video_series_suggestions, get_video_suggestions, search_video_seriez, search_videos,
    VideoSearchResult, VideoSeriesSearchResult,
};

// import review (grouped by detected series) - mirrors
// `crate::music::entities::import_review`
pub use entities::import_review::{
    ListPendingVideoReviewRequest, MarkVideoGroupReviewedRequest, MoveVideoReviewRequest,
    PatchVideoGroupReviewRequest, PendingReviewVideoSummary, PendingVideoReviewGroup,
    PendingVideoReviewSession, VideoImportReviewOk, VideoPendingRequest, VideoPendingResponse,
    VideoReviewPatch,
};
pub use entities::import_review::repository as import_review_repository;
