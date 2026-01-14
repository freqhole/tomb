//! fetch music models - types for external media fetching

use serde::{Deserialize, Serialize};
use zod_gen::{zod_array, zod_number, zod_object, zod_string, ZodSchema};
use zod_gen_derive::ZodSchema;

/// parameters for fetching media from external URL
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct FetchMediaParams {
    /// URL to fetch (supports single videos, playlists, albums, etc.)
    pub url: String,
    /// user ID who initiated the fetch
    pub user_id: Option<String>,
}

/// result of fetch operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchMediaResult {
    /// total items found in URL (single video = 1, playlist = N)
    pub items_requested: u32,
    /// number of items successfully downloaded
    pub items_downloaded: u32,
    /// number of items that failed to download
    pub items_failed: u32,
    /// blob IDs of successfully processed media
    pub media_blob_ids: Vec<String>,
    /// song IDs created from fetched media
    pub song_ids: Vec<String>,
    /// errors encountered during fetch (non-fatal)
    pub errors: Vec<String>,
    /// downloaded files (internal - not exposed in API)
    #[serde(skip)]
    pub items_downloaded_files: Vec<DownloadedFile>,
}

impl ZodSchema for FetchMediaResult {
    fn zod_schema() -> String {
        zod_object(&[
            ("items_requested", &zod_number()),
            ("items_downloaded", &zod_number()),
            ("items_failed", &zod_number()),
            ("media_blob_ids", &zod_array(zod_string())),
            ("song_ids", &zod_array(zod_string())),
            ("errors", &zod_array(zod_string())),
        ])
    }
}

/// metadata extracted from external source (precheck)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentMetadata {
    /// platform/service (youtube, soundcloud, etc.)
    pub platform: String,
    /// unique content ID from platform
    pub content_id: String,
    /// title/name
    pub title: Option<String>,
    /// artist/creator
    pub artist: Option<String>,
    /// uploader/channel name
    pub uploader: Option<String>,
    /// duration in seconds
    pub duration_seconds: Option<i64>,
    /// original URL
    pub url: String,
    /// playlist title if part of collection
    pub playlist_title: Option<String>,
    /// playlist index if part of collection
    pub playlist_index: Option<i64>,
    /// raw JSON metadata from external command
    pub raw_metadata: serde_json::Value,
}

/// downloaded file information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadedFile {
    /// absolute path to downloaded file
    pub file_path: String,
    /// content ID from metadata
    pub content_id: String,
    /// extracted metadata
    pub metadata: ContentMetadata,
}

impl ContentMetadata {
    /// parse from yt-dlp JSON output
    pub fn from_json(json_str: &str) -> Result<Self, String> {
        let metadata: serde_json::Value = serde_json::from_str(json_str)
            .map_err(|e| format!("failed to parse metadata JSON: {}", e))?;

        // extract platform from extractor name
        let platform = metadata["extractor"]
            .as_str()
            .unwrap_or("unknown")
            .to_lowercase();

        // get content ID (required)
        let content_id = metadata["id"]
            .as_str()
            .ok_or("no content ID found in metadata")?
            .to_string();

        // extract optional fields
        let title = metadata["title"].as_str().map(String::from);
        let artist = metadata["artist"].as_str().map(String::from);
        let uploader = metadata["uploader"].as_str().map(String::from);
        let duration_seconds = metadata["duration"].as_i64();
        let playlist_title = metadata["playlist_title"].as_str().map(String::from);
        let playlist_index = metadata["playlist_index"].as_i64();

        Ok(Self {
            platform,
            content_id,
            title,
            artist,
            uploader,
            duration_seconds,
            url: metadata["webpage_url"].as_str().unwrap_or("").to_string(),
            playlist_title,
            playlist_index,
            raw_metadata: metadata,
        })
    }

    /// check if this content already exists in database by content_id
    pub async fn check_exists_in_db(&self) -> Result<Option<String>, String> {
        let pool = match crate::database::connect().await {
            Ok(p) => p,
            Err(e) => return Err(format!("failed to connect to database: {}", e)),
        };

        let row = sqlx::query!(
            r#"SELECT id as "id!" FROM media_blobz WHERE content_id = ? LIMIT 1"#,
            self.content_id
        )
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("failed to check content existence: {}", e))?;

        Ok(row.map(|r| r.id))
    }
}

impl FetchMediaResult {
    /// create empty result
    pub fn empty() -> Self {
        Self {
            items_requested: 0,
            items_downloaded: 0,
            items_failed: 0,
            media_blob_ids: Vec::new(),
            song_ids: Vec::new(),
            errors: Vec::new(),
            items_downloaded_files: Vec::new(),
        }
    }

    /// create result from downloaded files
    pub fn from_downloads(
        total_requested: u32,
        downloaded: Vec<DownloadedFile>,
        errors: Vec<String>,
    ) -> Self {
        Self {
            items_requested: total_requested,
            items_downloaded: downloaded.len() as u32,
            items_failed: total_requested.saturating_sub(downloaded.len() as u32),
            media_blob_ids: Vec::new(), // filled in after processing
            song_ids: Vec::new(),       // filled in after processing
            errors,
            items_downloaded_files: downloaded,
        }
    }
}
