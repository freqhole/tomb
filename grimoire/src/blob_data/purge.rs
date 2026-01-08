//! Media blob purge utilities
//! Finds and removes media blobs that have no references in any table

use crate::database;
use crate::error::GrimoireResult;
use crate::media_blobz::{delete_media_blob, find_media_blob_references};
use std::time::Instant;

/// Summary of orphaned blob purge operation
#[derive(Debug, Clone)]
pub struct OrphanedBlobSummary {
    pub total_blobs_checked: u32,
    pub orphaned_blobs_found: u32,
    pub orphaned_blobs_deleted: u32,
    pub deletion_failures: u32,
    pub bytes_freed: u64,
    pub duration_ms: u64,
}

/// Information about an orphaned blob
#[derive(Debug, Clone)]
pub struct OrphanedBlob {
    pub id: String,
    pub size: Option<i64>,
    pub mime: Option<String>,
    pub blob_type: String,
    pub created_at: i64,
}

/// Find all orphaned media blobs (blobs with zero references)
pub async fn find_orphaned_media_blobs() -> GrimoireResult<Vec<OrphanedBlob>> {
    let start_time = Instant::now();
    let pool = database::connect().await?;

    // Get all non-deleted media blobs
    let all_blobs = sqlx::query!(
        "SELECT id as \"id!\", size, mime, blob_type as \"blob_type!\", created_at as \"created_at!\"
         FROM media_blobz
         WHERE deleted_at IS NULL
         ORDER BY created_at ASC"
    )
    .fetch_all(&pool)
    .await?;

    let mut orphaned_blobs = Vec::new();
    let total_blobs = all_blobs.len();

    println!("Checking {} media blobs for references...", total_blobs);

    for blob in all_blobs {
        // Check if this blob has any references
        let refs = find_media_blob_references(&blob.id).await?;

        if !refs.has_references() {
            orphaned_blobs.push(OrphanedBlob {
                id: blob.id,
                size: blob.size,
                mime: blob.mime,
                blob_type: blob.blob_type,
                created_at: blob.created_at,
            });
        }
    }

    let duration_ms = start_time.elapsed().as_millis() as u64;
    println!(
        "Found {} orphaned blobs out of {} total (took {}ms)",
        orphaned_blobs.len(),
        total_blobs,
        duration_ms
    );

    Ok(orphaned_blobs)
}

/// Clean up all orphaned media blobs
pub async fn cleanup_orphaned_media_blobs() -> GrimoireResult<OrphanedBlobSummary> {
    let start_time = Instant::now();

    // Find orphaned blobs
    let orphaned_blobs = find_orphaned_media_blobs().await?;

    let mut deleted_count = 0;
    let mut failure_count = 0;
    let mut bytes_freed = 0u64;

    println!("Deleting {} orphaned media blobs...", orphaned_blobs.len());

    for blob in &orphaned_blobs {
        println!("  Deleting orphaned blob: {}", blob.id);

        match delete_media_blob(&blob.id, Some("blob_purge".to_string())).await {
            Ok(()) => {
                deleted_count += 1;
                if let Some(size) = blob.size {
                    bytes_freed += size as u64;
                }
                println!("    ✓ Deleted: {}", blob.id);
            }
            Err(e) => {
                failure_count += 1;
                eprintln!("    ✗ Failed to delete {}: {}", blob.id, e);
            }
        }
    }

    let duration_ms = start_time.elapsed().as_millis() as u64;

    let summary = OrphanedBlobSummary {
        total_blobs_checked: orphaned_blobs.len() as u32,
        orphaned_blobs_found: orphaned_blobs.len() as u32,
        orphaned_blobs_deleted: deleted_count,
        deletion_failures: failure_count,
        bytes_freed,
        duration_ms,
    };

    println!(
        "Orphaned blob cleanup completed: deleted {}/{} blobs, freed {} bytes ({}ms)",
        deleted_count,
        orphaned_blobs.len(),
        bytes_freed,
        duration_ms
    );

    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_orphaned_blob_summary() {
        let summary = OrphanedBlobSummary {
            total_blobs_checked: 100,
            orphaned_blobs_found: 5,
            orphaned_blobs_deleted: 4,
            deletion_failures: 1,
            bytes_freed: 1024000,
            duration_ms: 2500,
        };

        assert_eq!(summary.orphaned_blobs_found, 5);
        assert_eq!(summary.orphaned_blobs_deleted, 4);
        assert_eq!(summary.deletion_failures, 1);
    }

    #[test]
    fn test_orphaned_blob() {
        let blob = OrphanedBlob {
            id: "test123".to_string(),
            size: Some(5000),
            mime: Some("image/webp".to_string()),
            blob_type: "original".to_string(),
            created_at: 1000000000,
        };

        assert_eq!(blob.id, "test123");
        assert_eq!(blob.blob_type, "original");
        assert!(blob.size.unwrap() > 0);
    }
}
