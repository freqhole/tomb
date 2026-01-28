//! Media blob cleanup utilities
//! Functions to safely check references and clean up unused media blobs

use crate::database;
use crate::error::GrimoireResult;

/// Information about where a media blob is referenced
#[derive(Debug, Clone, serde::Serialize)]
pub struct MediaBlobReferences {
    pub blob_id: String,
    pub song_media_references: i64,
    pub playlist_image_references: i64,
    pub artist_image_references: i64,
    pub album_image_references: i64,
    pub song_image_references: i64,
    pub child_blob_references: i64, // Other blobs that have this as parent
}

impl MediaBlobReferences {
    /// Check if this blob has any references (should not be deleted)
    pub fn has_references(&self) -> bool {
        self.song_media_references > 0
            || self.playlist_image_references > 0
            || self.artist_image_references > 0
            || self.album_image_references > 0
            || self.song_image_references > 0
            || self.child_blob_references > 0
    }

    /// Get total reference count
    pub fn total_references(&self) -> i64 {
        self.song_media_references
            + self.playlist_image_references
            + self.artist_image_references
            + self.album_image_references
            + self.song_image_references
            + self.child_blob_references
    }
}

/// Find all references to a media blob across all tables
pub async fn find_media_blob_references(blob_id: &str) -> GrimoireResult<MediaBlobReferences> {
    let pool = database::connect().await?;

    // Check song media blob references
    let song_media_refs = sqlx::query!(
        "SELECT COUNT(*) as count FROM songz WHERE media_blob_id = ? AND deleted_at IS NULL",
        blob_id
    )
    .fetch_one(&pool)
    .await?
    .count;

    // Check playlist image references
    let playlist_image_refs = sqlx::query!(
        "SELECT COUNT(*) as count FROM playlist_imagez WHERE media_blob_id = ?",
        blob_id
    )
    .fetch_one(&pool)
    .await?
    .count;

    // Check artist image references
    let artist_image_refs = sqlx::query!(
        "SELECT COUNT(*) as count FROM artist_imagez WHERE media_blob_id = ?",
        blob_id
    )
    .fetch_one(&pool)
    .await?
    .count;

    // Check album image references
    let album_image_refs = sqlx::query!(
        "SELECT COUNT(*) as count FROM album_imagez WHERE media_blob_id = ?",
        blob_id
    )
    .fetch_one(&pool)
    .await?
    .count;

    // Check song image references
    let song_image_refs = sqlx::query!(
        "SELECT COUNT(*) as count FROM song_imagez WHERE media_blob_id = ?",
        blob_id
    )
    .fetch_one(&pool)
    .await?
    .count;

    // Check for child blobs (thumbnails, waveforms derived from this blob)
    let child_blob_refs = sqlx::query!(
        "SELECT COUNT(*) as count FROM media_blobz WHERE parent_blob_id = ? AND deleted_at IS NULL",
        blob_id
    )
    .fetch_one(&pool)
    .await?
    .count;

    Ok(MediaBlobReferences {
        blob_id: blob_id.to_string(),
        song_media_references: song_media_refs,
        playlist_image_references: playlist_image_refs,
        artist_image_references: artist_image_refs,
        album_image_references: album_image_refs,
        song_image_references: song_image_refs,
        child_blob_references: child_blob_refs,
    })
}

/// Check if a media blob can be safely deleted (has no references)
pub async fn can_delete_media_blob(blob_id: &str) -> GrimoireResult<bool> {
    let refs = find_media_blob_references(blob_id).await?;
    Ok(!refs.has_references())
}

/// Safely delete a media blob only if it has no references
/// Returns true if deleted, false if it has references (and wasn't deleted)
pub async fn delete_media_blob_if_unused(
    blob_id: &str,
    deleted_by: Option<String>,
) -> GrimoireResult<bool> {
    if can_delete_media_blob(blob_id).await? {
        use crate::media_blobz::delete_media_blob;
        delete_media_blob(blob_id, deleted_by).await?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_media_blob_references_has_references() {
        let refs = MediaBlobReferences {
            blob_id: "test".to_string(),
            song_media_references: 1,
            song_thumbnail_references: 0,
            song_waveform_references: 0,
            playlist_thumbnail_references: 0,
            playlist_image_references: 0,
            artist_image_references: 0,
            album_image_references: 0,
            song_image_references: 0,
            child_blob_references: 0,
        };

        assert!(refs.has_references());
        assert_eq!(refs.total_references(), 1);
    }

    #[tokio::test]
    async fn test_media_blob_references_no_references() {
        let refs = MediaBlobReferences {
            blob_id: "test".to_string(),
            song_media_references: 0,
            song_thumbnail_references: 0,
            song_waveform_references: 0,
            playlist_thumbnail_references: 0,
            playlist_image_references: 0,
            artist_image_references: 0,
            album_image_references: 0,
            song_image_references: 0,
            child_blob_references: 0,
        };

        assert!(!refs.has_references());
        assert_eq!(refs.total_references(), 0);
    }
}
