//! Videos domain models
//!
//! This module provides data models for videos, playlists, and related entities
//! in the videos domain. These models represent the database entities and provide
//! methods for data validation and transformation.

use crate::media::traits::{MediaCollection, MediaItem};
use bigdecimal::BigDecimal;
use serde::{Deserialize, Serialize};
use sqlx::postgres::types::PgInterval;
use time::OffsetDateTime;
use uuid::Uuid;

/// A video entity representing a video file
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Video {
    pub id: Uuid,
    pub media_blob_id: String,
    pub thumbnail_blob_id: Option<String>,
    pub thumbnail_blob_ids: Option<Vec<String>>, // Array of 10 thumbnails
    pub title: String,
    pub description: Option<String>,
    #[serde(skip)]
    pub duration: Option<PgInterval>,
    pub width_px: Option<i32>,
    pub height_px: Option<i32>,
    pub fps: Option<BigDecimal>,
    pub bitrate: Option<i32>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub container_format: Option<String>,
    pub is_hdr: Option<bool>,
    pub color_profile: Option<String>,
    pub audio_channels: Option<i32>,
    pub audio_sample_rate: Option<i32>,
    pub subtitles_available: Option<bool>,
    #[serde(skip)]
    pub watch_progress: Option<PgInterval>,
    pub rating: Option<i32>,
    pub is_favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub metadata: serde_json::Value,
    pub deleted_at: Option<OffsetDateTime>,
    pub deleted_by: Option<Uuid>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub version: i64,
}

/// Video metadata extracted from video files
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoMetadata {
    /// Video duration in seconds
    pub duration: Option<f64>,
    /// Video width in pixels
    pub width_px: Option<i32>,
    /// Video height in pixels
    pub height_px: Option<i32>,
    /// Frame rate (fps)
    pub fps: Option<f64>,
    /// Video codec (e.g., "h264", "hevc")
    pub video_codec: Option<String>,
    /// Audio codec (e.g., "aac", "mp3")
    pub audio_codec: Option<String>,
    /// Total bitrate in kbps
    pub bitrate: Option<i32>,
    /// Container format (e.g., "mp4", "mov")
    pub container_format: Option<String>,
    /// HDR support
    pub is_hdr: Option<bool>,
    /// Color profile
    pub color_profile: Option<String>,
    /// Audio channels
    pub audio_channels: Option<i32>,
    /// Audio sample rate
    pub audio_sample_rate: Option<i32>,
    /// Subtitles available
    pub subtitles_available: Option<bool>,
    /// Extended metadata from video file
    pub extended_metadata: Option<serde_json::Value>,
}

impl Default for VideoMetadata {
    fn default() -> Self {
        Self {
            duration: None,
            width_px: None,
            height_px: None,
            fps: None,
            video_codec: None,
            audio_codec: None,
            bitrate: None,
            container_format: None,
            is_hdr: None,
            color_profile: None,
            audio_channels: None,
            audio_sample_rate: None,
            subtitles_available: None,
            extended_metadata: None,
        }
    }
}

/// A video playlist entity for organizing videos
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct VideoPlaylist {
    pub id: Uuid,
    pub media_blob_id: Option<String>,
    pub thumbnail_blob_id: Option<String>,

    pub title: String,
    pub description: Option<String>,
    pub client_id: Option<String>,
    pub is_public: Option<bool>,
    pub is_collaborative: Option<bool>,
    pub metadata: serde_json::Value,
    pub deleted_at: Option<OffsetDateTime>,
    pub deleted_by: Option<Uuid>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub version: i64,
}

/// Junction table for video playlist items
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct VideoPlaylistItem {
    pub id: Uuid,
    pub playlist_id: Uuid,
    pub video_id: Uuid,
    pub position: i32,
    pub created_at: OffsetDateTime,
    pub added_by_client_id: Option<String>,
    pub metadata: serde_json::Value,
}

/// Create video request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateVideo {
    pub media_blob_id: String,
    pub thumbnail_blob_id: Option<String>,
    pub thumbnail_blob_ids: Option<Vec<String>>,
    pub title: String,
    pub description: Option<String>,
    pub is_favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub metadata: Option<serde_json::Value>,
}

/// Update video request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateVideo {
    pub title: Option<String>,
    pub description: Option<String>,
    pub thumbnail_blob_id: Option<String>,
    pub is_favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub rating: Option<i32>,
}

/// Create video playlist request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateVideoPlaylist {
    pub title: String,
    pub description: Option<String>,
    pub client_id: Option<String>,
    pub is_public: Option<bool>,
    pub is_collaborative: Option<bool>,
    pub thumbnail_blob_id: Option<String>,
}

/// Update video playlist request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateVideoPlaylist {
    pub title: Option<String>,
    pub description: Option<String>,
    pub is_public: Option<bool>,
    pub is_collaborative: Option<bool>,
    pub thumbnail_blob_id: Option<String>,
}

/// Video query parameters
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VideoQuery {
    pub is_favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub search: Option<String>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub container_format: Option<String>,
    pub rating: Option<i32>,
    pub duration_min: Option<i32>,
    pub duration_max: Option<i32>,
    pub width_min: Option<i32>,
    pub width_max: Option<i32>,
    pub height_min: Option<i32>,
    pub height_max: Option<i32>,
    pub created_after: Option<OffsetDateTime>,
    pub created_before: Option<OffsetDateTime>,
    pub has_hdr: Option<bool>,
}

/// Video playlist query parameters
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VideoPlaylistQuery {
    pub is_public: Option<bool>,
    pub is_collaborative: Option<bool>,
    pub search: Option<String>,
    pub created_after: Option<OffsetDateTime>,
    pub created_before: Option<OffsetDateTime>,
    pub client_id: Option<String>,
}

impl MediaItem for Video {
    type Metadata = VideoMetadata;
    type Collection = VideoPlaylist;

    fn id(&self) -> Uuid {
        self.id
    }

    fn media_blob_id(&self) -> &str {
        &self.media_blob_id
    }

    fn thumbnail_blob_id(&self) -> Option<&str> {
        self.thumbnail_blob_id.as_deref()
    }

    fn title(&self) -> &str {
        &self.title
    }

    fn created_at(&self) -> OffsetDateTime {
        self.created_at
    }

    fn updated_at(&self) -> OffsetDateTime {
        self.updated_at
    }

    fn version(&self) -> i64 {
        self.version
    }

    fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }

    fn is_favorite(&self) -> bool {
        self.is_favorite.unwrap_or(false)
    }

    fn tags(&self) -> &[String] {
        self.tags.as_deref().unwrap_or(&[])
    }

    fn metadata(&self) -> &Self::Metadata {
        // For performance, we'll store a cached version
        // In a real implementation, you might want to use a lazy_static or similar
        // For now, we'll return a default metadata reference
        static DEFAULT_METADATA: std::sync::LazyLock<VideoMetadata> =
            std::sync::LazyLock::new(|| VideoMetadata::default());

        &DEFAULT_METADATA
    }

    fn display_title(&self) -> String {
        if self.title.is_empty() {
            // Use media_blob_id as fallback if title is empty
            self.media_blob_id.clone()
        } else {
            self.title.clone()
        }
    }

    fn typical_extensions() -> &'static [&'static str] {
        &[
            "mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v", "3gp", "ogv",
        ]
    }

    fn supported_mime_types() -> &'static [&'static str] {
        &[
            "video/mp4",
            "video/quicktime",
            "video/x-msvideo",
            "video/x-matroska",
            "video/webm",
            "video/x-flv",
            "video/x-ms-wmv",
            "video/x-m4v",
            "video/3gpp",
            "video/ogg",
        ]
    }
}

impl MediaCollection for VideoPlaylist {
    type Item = Video;

    fn id(&self) -> Uuid {
        self.id
    }

    fn title(&self) -> &str {
        &self.title
    }

    fn description(&self) -> Option<&str> {
        self.description.as_deref()
    }

    fn created_at(&self) -> OffsetDateTime {
        self.created_at
    }

    fn updated_at(&self) -> OffsetDateTime {
        self.updated_at
    }

    fn version(&self) -> i64 {
        self.version
    }

    fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }

    fn is_public(&self) -> bool {
        self.is_public.unwrap_or(false)
    }

    fn is_collaborative(&self) -> bool {
        self.is_collaborative.unwrap_or(false)
    }

    fn thumbnail_blob_id(&self) -> Option<&str> {
        self.thumbnail_blob_id.as_deref()
    }

    fn client_id(&self) -> Option<&str> {
        self.client_id.as_deref()
    }
}

impl Video {
    /// Get a display name for the video
    pub fn display_name(&self) -> String {
        self.display_title()
    }

    /// Get video codec information
    pub fn codec_info(&self) -> Option<String> {
        match (&self.video_codec, &self.audio_codec) {
            (Some(video), Some(audio)) => Some(format!("{}/{}", video, audio)),
            (Some(video), None) => Some(video.clone()),
            (None, Some(audio)) => Some(format!("audio: {}", audio)),
            (None, None) => None,
        }
    }

    /// Get technical information about the video
    pub fn technical_info(&self) -> Vec<String> {
        let mut info = Vec::new();

        if let (Some(width), Some(height)) = (self.width_px, self.height_px) {
            info.push(format!("{}x{}", width, height));
        }

        if let Some(fps) = &self.fps {
            info.push(format!("{}fps", fps));
        }

        if let Some(bitrate) = self.bitrate {
            info.push(format!("{}kbps", bitrate));
        }

        if let Some(codec) = self.codec_info() {
            info.push(codec);
        }

        if let Some(container) = &self.container_format {
            info.push(container.to_uppercase());
        }

        info
    }

    /// Get video duration in a human-readable format
    pub fn duration_formatted(&self) -> Option<String> {
        self.duration.as_ref().map(|_| {
            // This would need proper PgInterval formatting
            // For now, return a placeholder
            "00:00:00".to_string()
        })
    }

    /// Get aspect ratio as a float
    pub fn aspect_ratio_float(&self) -> Option<f64> {
        match (self.width_px, self.height_px) {
            (Some(width), Some(height)) if height > 0 => Some(width as f64 / height as f64),
            _ => None,
        }
    }

    /// Get orientation category based on aspect ratio
    pub fn orientation_category(&self) -> String {
        match self.aspect_ratio_float() {
            Some(ratio) if ratio > 1.5 => "landscape".to_string(),
            Some(ratio) if ratio < 0.75 => "portrait".to_string(),
            Some(_) => "square".to_string(),
            None => "unknown".to_string(),
        }
    }

    /// Check if the video is deleted
    pub fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }

    /// Get the number of thumbnails available
    pub fn thumbnail_count(&self) -> usize {
        self.thumbnail_blob_ids.as_ref().map_or(0, |ids| ids.len())
    }

    /// Get the primary thumbnail (2nd in the array, or first if less than 2)
    pub fn primary_thumbnail(&self) -> Option<&str> {
        self.thumbnail_blob_ids.as_ref().and_then(|ids| {
            if ids.len() >= 2 {
                ids.get(1).map(|s| s.as_str())
            } else {
                ids.first().map(|s| s.as_str())
            }
        })
    }
}

impl VideoPlaylist {
    /// Check if the playlist is deleted
    pub fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }

    pub fn is_public(&self) -> bool {
        self.is_public.unwrap_or(false)
    }

    pub fn is_collaborative(&self) -> bool {
        self.is_collaborative.unwrap_or(false)
    }

    /// Get display title with video count
    pub fn display_title_with_count(&self, count: usize) -> String {
        format!("{} ({} videos)", self.title, count)
    }
}

impl VideoMetadata {
    /// Create metadata from video file analysis
    pub fn from_ffprobe(ffprobe_output: &serde_json::Value) -> Self {
        let format = ffprobe_output.get("format").and_then(|f| f.as_object());
        let streams = ffprobe_output.get("streams").and_then(|s| s.as_array());

        let video_stream = streams.and_then(|streams| {
            streams
                .iter()
                .find(|stream| stream.get("codec_type").and_then(|ct| ct.as_str()) == Some("video"))
        });

        let audio_stream = streams.and_then(|streams| {
            streams
                .iter()
                .find(|stream| stream.get("codec_type").and_then(|ct| ct.as_str()) == Some("audio"))
        });

        let duration = format
            .and_then(|f| f.get("duration"))
            .and_then(|d| d.as_str())
            .and_then(|d| d.parse::<f64>().ok());

        let width_px = video_stream
            .and_then(|vs| vs.get("width"))
            .and_then(|w| w.as_i64())
            .map(|w| w as i32);

        let height_px = video_stream
            .and_then(|vs| vs.get("height"))
            .and_then(|h| h.as_i64())
            .map(|h| h as i32);

        let fps = video_stream
            .and_then(|vs| vs.get("r_frame_rate"))
            .and_then(|fr| fr.as_str())
            .and_then(|fr| {
                // Handle frame rates like "30/1" or "25/1"
                if let Some((num, den)) = fr.split_once('/') {
                    if let (Ok(n), Ok(d)) = (num.parse::<f64>(), den.parse::<f64>()) {
                        if d != 0.0 {
                            Some(n / d)
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    fr.parse::<f64>().ok()
                }
            });

        let video_codec = video_stream
            .and_then(|vs| vs.get("codec_name"))
            .and_then(|cn| cn.as_str())
            .map(|cn| cn.to_string());

        let audio_codec = audio_stream
            .and_then(|as_| as_.get("codec_name"))
            .and_then(|cn| cn.as_str())
            .map(|cn| cn.to_string());

        let bitrate = format
            .and_then(|f| f.get("bit_rate"))
            .and_then(|br| br.as_str())
            .and_then(|br| br.parse::<i32>().ok())
            .map(|br| br / 1000); // Convert to kbps

        let container_format = format
            .and_then(|f| f.get("format_name"))
            .and_then(|fn_| fn_.as_str())
            .map(|fn_| fn_.to_string());

        // We'll store HDR and color profile info if available in extended metadata
        let is_hdr = None; // Would need separate extraction
        let color_profile = None; // Would need separate extraction

        Self {
            duration,
            width_px,
            height_px,
            fps,
            video_codec,
            audio_codec,
            bitrate,
            container_format,
            is_hdr,
            color_profile,
            audio_channels: None,      // Would need separate extraction
            audio_sample_rate: None,   // Would need separate extraction
            subtitles_available: None, // Would need separate extraction
            extended_metadata: Some(ffprobe_output.clone()),
        }
    }

    /// Check if metadata has codec information
    pub fn has_codec_info(&self) -> bool {
        self.video_codec.is_some() || self.audio_codec.is_some()
    }

    /// Check if metadata has technical information
    pub fn has_technical_info(&self) -> bool {
        self.duration.is_some() || self.width_px.is_some() || self.height_px.is_some()
    }

    /// Check if metadata has quality information
    pub fn has_quality_info(&self) -> bool {
        self.bitrate.is_some() || self.fps.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_video_display_title() {
        let video = Video {
            title: Some("My Video".to_string()),
            file_name: Some("video.mp4".to_string()),
            media_blob_id: "blob123".to_string(),
            ..Default::default()
        };

        assert_eq!(video.display_title(), "My Video");

        let video_no_title = Video {
            title: None,
            file_name: Some("video.mp4".to_string()),
            media_blob_id: "blob123".to_string(),
            ..Default::default()
        };

        assert_eq!(video_no_title.display_title(), "video.mp4");
    }

    #[test]
    fn test_video_codec_info() {
        let video = Video {
            video_codec: Some("h264".to_string()),
            audio_codec: Some("aac".to_string()),
            ..Default::default()
        };

        assert_eq!(video.codec_info(), Some("h264/aac".to_string()));

        let video_video_only = Video {
            video_codec: Some("h264".to_string()),
            audio_codec: None,
            ..Default::default()
        };

        assert_eq!(video_video_only.codec_info(), Some("h264".to_string()));
    }

    #[test]
    fn test_video_metadata_from_ffprobe() {
        let ffprobe_data = json!({
            "format": {
                "duration": "120.5",
                "bit_rate": "2000000",
                "format_name": "mov,mp4,m4a,3gp,3g2,mj2"
            },
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 1920,
                    "height": 1080,
                    "r_frame_rate": "30/1"
                },
                {
                    "codec_type": "audio",
                    "codec_name": "aac"
                }
            ]
        });

        let metadata = VideoMetadata::from_ffprobe(&ffprobe_data);

        assert_eq!(metadata.duration, Some(120.5));
        assert_eq!(metadata.width_px, Some(1920));
        assert_eq!(metadata.height_px, Some(1080));
        assert_eq!(metadata.fps, Some(30.0));
        assert_eq!(metadata.video_codec, Some("h264".to_string()));
        assert_eq!(metadata.audio_codec, Some("aac".to_string()));
        assert_eq!(metadata.bitrate, Some(2000)); // 2000000 / 1000 = 2000 kbps
    }

    #[test]
    fn test_video_aspect_ratio() {
        let video = Video {
            width_px: Some(1920),
            height_px: Some(1080),
            ..Default::default()
        };

        assert!((video.aspect_ratio_float().unwrap() - 1.777777777777778).abs() < 0.0001);
        assert_eq!(video.orientation_category(), "landscape");

        let portrait_video = Video {
            width_px: Some(1080),
            height_px: Some(1920),
            ..Default::default()
        };

        assert_eq!(portrait_video.orientation_category(), "portrait");
    }

    #[test]
    fn test_video_orientation_category() {
        let landscape = Video {
            width_px: Some(1920),
            height_px: Some(1080),
            ..Default::default()
        };
        assert_eq!(landscape.orientation_category(), "landscape");

        let portrait = Video {
            width_px: Some(1080),
            height_px: Some(1920),
            ..Default::default()
        };
        assert_eq!(portrait.orientation_category(), "portrait");

        let square = Video {
            width_px: Some(1080),
            height_px: Some(1080),
            ..Default::default()
        };
        assert_eq!(square.orientation_category(), "square");
    }

    #[test]
    fn test_video_thumbnail_handling() {
        let video = Video {
            thumbnail_blob_ids: Some(vec![
                "thumb1".to_string(),
                "thumb2".to_string(),
                "thumb3".to_string(),
            ]),
            ..Default::default()
        };

        assert_eq!(video.thumbnail_count(), 3);
        assert_eq!(video.primary_thumbnail(), Some("thumb2")); // 2nd thumbnail

        let single_thumb = Video {
            thumbnail_blob_ids: Some(vec!["thumb1".to_string()]),
            ..Default::default()
        };

        assert_eq!(single_thumb.primary_thumbnail(), Some("thumb1")); // Falls back to first
    }
}

impl Default for Video {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4(),
            media_blob_id: String::new(),
            thumbnail_blob_id: None,
            thumbnail_blob_ids: None,
            title: String::new(),
            description: None,
            duration: None,
            width_px: None,
            height_px: None,
            fps: None,
            bitrate: None,
            video_codec: None,
            audio_codec: None,
            container_format: None,
            is_hdr: None,
            color_profile: None,
            audio_channels: None,
            audio_sample_rate: None,
            subtitles_available: None,
            watch_progress: None,
            rating: None,
            is_favorite: None,
            tags: None,
            metadata: serde_json::json!({}),
            deleted_at: None,
            deleted_by: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
            version: 1,
        }
    }
}

impl Default for VideoPlaylist {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4(),
            media_blob_id: None,
            thumbnail_blob_id: None,

            title: String::new(),
            description: None,
            client_id: None,
            is_public: Some(false),
            is_collaborative: Some(false),
            metadata: serde_json::json!({}),
            deleted_at: None,
            deleted_by: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
            version: 1,
        }
    }
}
