//! scanned directories tracking
//!
//! tracks which directories have been scanned for music files
//! used by rescan jobs to know what to check

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use time::OffsetDateTime;

use crate::database;
use crate::GrimoireResponse;

/// scanned directory model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedDirectory {
    pub id: String,
    pub path: String,
    pub recursive: i64, // sqlite boolean (0/1)
    pub last_scanned_at: i64,
    pub file_count: i64,
    pub created_by: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// record a scanned directory after successful scan
pub async fn record_scanned_directory(
    path: &str,
    file_count: i64,
    created_by: Option<String>,
) -> GrimoireResponse<ScannedDirectory> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(format!("database connection failed: {}", e), vec![])
        }
    };

    // canonicalize before storing: scanned_directories.path is used as a prefix
    // for matching media_blobz.local_path during rescan/move/orphan-detection.
    // a non-canonical path here (tilde, symlink, flatpak portal) breaks all of that.
    let path = crate::paths::canonical_path_string(path);
    let path = path.as_str();

    let now = OffsetDateTime::now_utc().unix_timestamp();

    // insert or update if path already exists
    let result = sqlx::query!(
        r#"
        INSERT INTO scanned_directories (path, recursive, last_scanned_at, file_count, created_by)
        VALUES (?, 1, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
            last_scanned_at = excluded.last_scanned_at,
            file_count = excluded.file_count,
            updated_at = unixepoch()
        RETURNING id as "id!", path as "path!", recursive as "recursive!",
                  last_scanned_at as "last_scanned_at!", file_count as "file_count!",
                  created_by, created_at as "created_at!", updated_at as "updated_at!"
        "#,
        path,
        now,
        file_count,
        created_by
    )
    .fetch_one(&pool)
    .await;

    match result {
        Ok(row) => {
            let dir = ScannedDirectory {
                id: row.id,
                path: row.path,
                recursive: row.recursive,
                last_scanned_at: row.last_scanned_at,
                file_count: row.file_count,
                created_by: row.created_by,
                created_at: row.created_at,
                updated_at: row.updated_at,
            };
            GrimoireResponse::success("directory scan recorded", dir)
        }
        Err(e) => {
            GrimoireResponse::failure(format!("failed to record scanned directory: {}", e), vec![])
        }
    }
}

/// get all scanned directories
pub async fn list_scanned_directories() -> GrimoireResponse<Vec<ScannedDirectory>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(format!("database connection failed: {}", e), vec![])
        }
    };

    let result = sqlx::query_as!(
        ScannedDirectory,
        r#"
        SELECT id as "id!", path as "path!", recursive as "recursive!",
               last_scanned_at as "last_scanned_at!", file_count as "file_count!",
               created_by, created_at as "created_at!", updated_at as "updated_at!"
        FROM scanned_directories
        ORDER BY last_scanned_at DESC
        "#
    )
    .fetch_all(&pool)
    .await;

    match result {
        Ok(dirs) => {
            GrimoireResponse::success(format!("found {} scanned directories", dirs.len()), dirs)
        }
        Err(e) => {
            GrimoireResponse::failure(format!("failed to list scanned directories: {}", e), vec![])
        }
    }
}

/// get all scanned directories deduplicated (removes nested paths)
/// returns only the highest-level directories in the filesystem tree
pub async fn get_deduplicated_directories() -> GrimoireResponse<Vec<ScannedDirectory>> {
    let all_dirs_response = list_scanned_directories().await;

    if !all_dirs_response.success {
        return all_dirs_response;
    }

    let mut all_dirs = all_dirs_response.data.unwrap_or_default();

    // sort by path length (shortest first = highest in tree)
    all_dirs.sort_by_key(|d| d.path.len());

    let mut deduplicated = Vec::new();

    for dir in all_dirs {
        // check if this path is a subdirectory of any already-added path
        let is_subdirectory = deduplicated.iter().any(|parent: &ScannedDirectory| {
            dir.path.starts_with(&parent.path) && dir.path != parent.path
        });

        if !is_subdirectory {
            deduplicated.push(dir);
        }
    }

    GrimoireResponse::success(
        format!(
            "deduplicated to {} top-level directories",
            deduplicated.len()
        ),
        deduplicated,
    )
}

/// remove a scanned directory from tracking
pub async fn remove_scanned_directory(path: &str) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(format!("database connection failed: {}", e), vec![])
        }
    };

    let result = sqlx::query!(
        r#"
        DELETE FROM scanned_directories
        WHERE path = ?
        "#,
        path
    )
    .execute(&pool)
    .await;

    match result {
        Ok(result) => {
            if result.rows_affected() > 0 {
                GrimoireResponse::success("directory removed from tracking", ())
            } else {
                GrimoireResponse::failure("directory not found", vec![])
            }
        }
        Err(e) => GrimoireResponse::failure(format!("failed to remove directory: {}", e), vec![]),
    }
}

/// get all scanned directory paths as a HashSet for efficient lookup
/// paths are canonicalized (resolved, no trailing slashes)
pub async fn get_scanned_directory_paths() -> HashSet<PathBuf> {
    let response = list_scanned_directories().await;

    if !response.success {
        return HashSet::new();
    }

    response
        .data
        .unwrap_or_default()
        .into_iter()
        .filter_map(|dir| {
            // normalize: trim trailing slashes and canonicalize
            let path_str = dir.path.trim_end_matches('/');
            std::fs::canonicalize(path_str).ok()
        })
        .collect()
}
