//! radio station models.
//!
//! these mirror the schema in `migrations/023_radio_stationz.sql` 1:1.
//! `is_*` columns come back as `i64` (sqlite booleans); helpers convert.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// one radio "channel" the broadcaster can run.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, FromRow, PartialEq)]
pub struct RadioStation {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_public: i64,
    pub is_enabled: i64,
    /// per-station ffmpeg override; null = use toml `[radio].encode_args`
    /// (or `[radio].video_encode_args` for a video-capable content_mode -
    /// see `effective_encode_args`). resolved dynamically (never cached),
    /// so a per-station override always wins even if the node-wide
    /// config changes later.
    pub encode_args: Option<String>,
    /// mse codec string. unlike `encode_args`, always a concrete value -
    /// `create_station`/`update_station` fill it with the content_mode-
    /// appropriate node-wide default at write time when the caller
    /// doesn't supply one, and `update_station` also refreshes it
    /// whenever `content_mode` changes without an explicit `codec` in the
    /// same request (so a stale audio-only codec can't survive a switch
    /// to a video-capable mode - see repository.rs's `update_station`).
    pub codec: String,
    /// 'shuffle' | 'album'
    pub play_mode: String,
    /// when non-zero the broadcaster skips the audio uni stream entirely;
    /// all listeners use timeline/queue-mode playback.
    pub timeline_only_mode: i64,
    /// 'audio_only' | 'audio_or_video' | 'video_only' - gates whether the
    /// picker resolves song_ids/video_ids at all, independent of which
    /// filter rows exist. see migration 082's doc comment.
    pub content_mode: String,
    /// seconds between bumper plays; `None` disables bumpers for this
    /// station. read/write via `radio_bumpers_set_frequency` (also
    /// exposed here so listing/getting a station doesn't need a second
    /// round trip just to show the current cadence).
    pub bumper_frequency_seconds: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl RadioStation {
    /// resolves the ffmpeg args this station's encoder should actually
    /// run: an explicit per-station override if set, otherwise the
    /// node-wide config default for its content_mode - `audio_only`
    /// stations get `[radio].encode_args` (which strips video via
    /// `-vn`), anything video-capable gets `[radio].video_encode_args`
    /// instead. resolved fresh every time (never cached on the row), so
    /// changing `content_mode` takes effect immediately without also
    /// needing to touch `encode_args`.
    ///
    /// an empty-string override is treated the same as no override at
    /// all - `update_station`'s `COALESCE(?, encode_args)` can only ever
    /// preserve the existing value or set a new one, never clear it back
    /// to NULL (a bound NULL parameter means "don't touch this column",
    /// same as an omitted field), so clearing the admin UI's textarea
    /// and saving sends `""` as the only way to "revert to inherit" -
    /// without this, `""` would be used as the literal ffmpeg args
    /// (silently producing a broken encode command).
    pub fn effective_encode_args<'a>(
        &'a self,
        cfg: &'a crate::radio::config::RadioConfig,
    ) -> &'a str {
        self.encode_args
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or(if self.content_mode == "audio_only" {
                &cfg.encode_args
            } else {
                &cfg.video_encode_args
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn station(content_mode: &str, encode_args: Option<&str>) -> RadioStation {
        RadioStation {
            id: "s1".to_string(),
            name: "test".to_string(),
            description: None,
            is_public: 0,
            is_enabled: 1,
            encode_args: encode_args.map(str::to_string),
            codec: "audio/mp4; codecs=\"mp4a.40.2\"".to_string(),
            play_mode: "shuffle".to_string(),
            timeline_only_mode: 0,
            content_mode: content_mode.to_string(),
            bumper_frequency_seconds: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn effective_encode_args_uses_override_when_set() {
        let cfg = crate::radio::config::RadioConfig::default();
        let s = station("audio_only", Some("-vn -c:a libopus custom"));
        assert_eq!(s.effective_encode_args(&cfg), "-vn -c:a libopus custom");
    }

    #[test]
    fn effective_encode_args_falls_back_to_node_default_when_unset() {
        let cfg = crate::radio::config::RadioConfig::default();
        let s = station("audio_only", None);
        assert_eq!(s.effective_encode_args(&cfg), cfg.encode_args);
    }

    #[test]
    fn effective_encode_args_treats_empty_string_as_no_override() {
        // the only way `update_station`'s COALESCE can "clear" an
        // override from the admin UI - see the doc comment above.
        let cfg = crate::radio::config::RadioConfig::default();
        let audio = station("audio_only", Some(""));
        assert_eq!(audio.effective_encode_args(&cfg), cfg.encode_args);
        let video = station("video_only", Some(""));
        assert_eq!(video.effective_encode_args(&cfg), cfg.video_encode_args);
    }

    #[test]
    fn effective_encode_args_picks_video_default_for_video_capable_modes() {
        let cfg = crate::radio::config::RadioConfig::default();
        let s = station("audio_or_video", None);
        assert_eq!(s.effective_encode_args(&cfg), cfg.video_encode_args);
    }
}

/// create a new station. all fields except `name` are optional and use
/// the schema defaults (private, enabled, default codec, shuffle).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateStationRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub is_public: Option<bool>,
    #[serde(default)]
    pub is_enabled: Option<bool>,
    #[serde(default)]
    pub encode_args: Option<String>,
    #[serde(default)]
    pub codec: Option<String>,
    #[serde(default)]
    pub play_mode: Option<String>,
    /// when true the broadcaster will suppress the audio uni stream for
    /// this station and serve only timeline control messages.
    #[serde(default)]
    pub timeline_only_mode: Option<bool>,
    /// 'audio_only' (default) | 'audio_or_video' | 'video_only'.
    #[serde(default)]
    pub content_mode: Option<String>,
}

/// partial update — only present fields are written.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, Default)]
pub struct UpdateStationRequest {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub is_public: Option<bool>,
    #[serde(default)]
    pub is_enabled: Option<bool>,
    #[serde(default)]
    pub encode_args: Option<String>,
    #[serde(default)]
    pub codec: Option<String>,
    #[serde(default)]
    pub play_mode: Option<String>,
    /// when true the broadcaster will suppress the audio uni stream for
    /// this station and serve only timeline control messages.
    #[serde(default)]
    pub timeline_only_mode: Option<bool>,
    /// 'audio_only' | 'audio_or_video' | 'video_only'.
    #[serde(default)]
    pub content_mode: Option<String>,
}

/// one filter clause attached to a station.
///
/// reference-type clauses (artist/album/taxon/tag/track/playlist)
/// reference a real record id via exactly one of the FK columns
/// (`artist_id` / `album_id` / `taxon_id` / `tag_id` / `song_id` /
/// `playlist_id`), matching `filter_type`. the wire shape exposes
/// `filter_value` as the chosen FK id so existing ui code keeps
/// working — the picker no longer falls back to name lookups.
///
/// criteria-type clauses (favorite/rating/play_count/duration/
/// added_days) carry a plain numeric threshold in `criteria_value`
/// instead — see `StationFilterType` for the full list. `filter_value`
/// surfaces that threshold as a string for these (empty for
/// `favorite`, which needs no value at all).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, FromRow, PartialEq)]
pub struct StationFilter {
    pub id: String,
    pub station_id: String,
    /// see `StationFilterType` for every accepted value.
    pub filter_type: String,
    /// the FK id matching `filter_type` for reference types, or the
    /// numeric threshold (as a string) for criteria types. empty for
    /// `favorite`, which has no value.
    pub filter_value: String,
    /// human-readable label for `filter_value` (artist name, album
    /// title, taxon label, tag name, song title). populated by the
    /// repository via a left-join so the UI can render names without a
    /// second round-trip. empty for criteria types (no referenced
    /// record) or if the referenced row was deleted out from under the
    /// filter.
    #[serde(default)]
    pub filter_label: String,
    /// 'include' | 'exclude'
    pub mode: String,
    pub created_at: i64,
}

/// known filter-type values. wire form is the lowercase string.
///
/// note: `Taxon` replaced `Genre` in migration 038. the underlying FK
/// (`taxon_id`) targets `taxonz(id)` of any kind — genre, label, mood,
/// era, region, ... — so a single station can mix kinds in its seed
/// filters. legacy `"genre"` strings are accepted on input as an alias
/// for `"taxon"`.
///
/// migration 051 added nine "criteria" types alongside the six
/// reference types above. these carry a plain numeric threshold in
/// `criteria_value` (or no value at all, for `favorite`) instead of an
/// FK id — see `StationFilter` and `repository::song_ids_for_clause`
/// for resolution details.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StationFilterType {
    Artist,
    Album,
    Taxon,
    Tag,
    Track,
    Playlist,
    /// a single video (videoz row) - the video-domain equivalent of
    /// `Track`. added migration 081.
    Video,
    /// every video in a video_seriez (across every season) - the
    /// video-domain equivalent of `Album`. added migration 081.
    VideoSeries,
    /// every playable video in the library, no FK/value at all (like
    /// `Favorite` below) - lets a station shuffle across all videos
    /// without needing a `video_series` row per series. added for the
    /// "video-only station" prototype.
    AllVideos,
    /// song is favorited, or belongs to a favorited album/artist/
    /// playlist — any user, existential (see repository.rs). no value.
    Favorite,
    /// any user rated the song (or its album/artist, or a playlist
    /// containing it) at least this many stars (1-5).
    RatingGte,
    /// any user rated the song (or its album/artist, or a playlist
    /// containing it) at most this many stars (1-5).
    RatingLte,
    PlayCountGte,
    PlayCountLte,
    /// song duration in seconds, inclusive lower bound.
    DurationGte,
    /// song duration in seconds, inclusive upper bound.
    DurationLte,
    /// added at least this many days ago (i.e. older than the cutoff —
    /// see repository.rs for the days-ago-vs-timestamp inversion).
    AddedDaysGte,
    /// added at most this many days ago (i.e. more recent than the
    /// cutoff).
    AddedDaysLte,
}

impl StationFilterType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Artist => "artist",
            Self::Album => "album",
            Self::Taxon => "taxon",
            Self::Tag => "tag",
            Self::Track => "track",
            Self::Playlist => "playlist",
            Self::Video => "video",
            Self::VideoSeries => "video_series",
            Self::AllVideos => "all_videos",
            Self::Favorite => "favorite",
            Self::RatingGte => "rating_gte",
            Self::RatingLte => "rating_lte",
            Self::PlayCountGte => "play_count_gte",
            Self::PlayCountLte => "play_count_lte",
            Self::DurationGte => "duration_gte",
            Self::DurationLte => "duration_lte",
            Self::AddedDaysGte => "added_days_gte",
            Self::AddedDaysLte => "added_days_lte",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "artist" => Some(Self::Artist),
            "album" => Some(Self::Album),
            // accept legacy "genre" string from cached payloads / older clients
            "taxon" | "genre" => Some(Self::Taxon),
            "tag" => Some(Self::Tag),
            "track" => Some(Self::Track),
            "playlist" => Some(Self::Playlist),
            "video" => Some(Self::Video),
            "video_series" => Some(Self::VideoSeries),
            "all_videos" => Some(Self::AllVideos),
            "favorite" => Some(Self::Favorite),
            "rating_gte" => Some(Self::RatingGte),
            "rating_lte" => Some(Self::RatingLte),
            "play_count_gte" => Some(Self::PlayCountGte),
            "play_count_lte" => Some(Self::PlayCountLte),
            "duration_gte" => Some(Self::DurationGte),
            "duration_lte" => Some(Self::DurationLte),
            "added_days_gte" => Some(Self::AddedDaysGte),
            "added_days_lte" => Some(Self::AddedDaysLte),
            _ => None,
        }
    }

    /// true for the criteria types (numeric threshold or no value, as
    /// opposed to an FK reference id).
    pub fn is_criteria(self) -> bool {
        !matches!(
            self,
            Self::Artist
                | Self::Album
                | Self::Taxon
                | Self::Tag
                | Self::Track
                | Self::Playlist
                | Self::Video
                | Self::VideoSeries
        )
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StationFilterMode {
    Include,
    Exclude,
}

impl StationFilterMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Include => "include",
            Self::Exclude => "exclude",
        }
    }
}

/// one row of `radio_play_historyz`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, FromRow, PartialEq)]
pub struct PlayHistoryEntry {
    pub id: String,
    pub station_id: String,
    pub song_id: String,
    pub started_at: i64,
    pub duration_ms: Option<i64>,
    pub listener_count: i64,
}
