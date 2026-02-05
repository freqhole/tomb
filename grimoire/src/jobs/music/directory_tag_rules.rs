//! directory tag rules
//!
//! maps directory paths to tags - files under a directory get those tags on their albums
//! rules are additive (nested directories accumulate tags)

use serde::{Deserialize, Serialize};

use crate::database;
use crate::music::entities::tags::{find_or_create_tags, Tag};
use crate::GrimoireResponse;

/// directory tag rule model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryTagRule {
    pub id: String,
    pub directory_path: String,
    pub tag_id: String,
    pub tag_name: Option<String>, // populated via join
    pub created_by: Option<String>,
    pub created_at: i64,
}

/// add tags to a directory path (creates rules)
/// if tags don't exist, they are created
pub async fn add_directory_tags(
    directory_path: &str,
    tag_names: Vec<String>,
    created_by: Option<String>,
) -> GrimoireResponse<Vec<DirectoryTagRule>> {
    if tag_names.is_empty() {
        return GrimoireResponse::failure("must provide at least one tag name", vec![]);
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(format!("database connection failed: {}", e), vec![])
        }
    };

    // normalize path (ensure no trailing slash for consistency, except for root)
    let normalized_path = normalize_directory_path(directory_path);

    // find or create all tags
    let tags_response = find_or_create_tags(tag_names).await;
    if !tags_response.success {
        return GrimoireResponse::failure("failed to find or create tags", tags_response.errors);
    }
    let tags = tags_response.data.unwrap_or_default();

    let mut created_rules = Vec::new();

    for tag in tags {
        // insert rule (ignore if already exists)
        let result = sqlx::query!(
            r#"
            INSERT INTO directory_tag_rules (directory_path, tag_id, created_by)
            VALUES (?, ?, ?)
            ON CONFLICT(directory_path, tag_id) DO NOTHING
            RETURNING id as "id!", directory_path as "directory_path!", tag_id as "tag_id!",
                      created_by, created_at as "created_at!"
            "#,
            normalized_path,
            tag.id,
            created_by
        )
        .fetch_optional(&pool)
        .await;

        match result {
            Ok(Some(row)) => {
                created_rules.push(DirectoryTagRule {
                    id: row.id,
                    directory_path: row.directory_path,
                    tag_id: row.tag_id,
                    tag_name: Some(tag.name.clone()),
                    created_by: row.created_by,
                    created_at: row.created_at,
                });
            }
            Ok(None) => {
                // rule already existed, that's fine
            }
            Err(e) => {
                return GrimoireResponse::failure(
                    format!("failed to create directory tag rule: {}", e),
                    vec![],
                );
            }
        }
    }

    GrimoireResponse::success(
        format!(
            "added {} tag rules for {}",
            created_rules.len(),
            normalized_path
        ),
        created_rules,
    )
}

/// remove specific tag rules from a directory
pub async fn remove_directory_tags(
    directory_path: &str,
    tag_names: Vec<String>,
) -> GrimoireResponse<u64> {
    if tag_names.is_empty() {
        return GrimoireResponse::failure("must provide at least one tag name", vec![]);
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(format!("database connection failed: {}", e), vec![])
        }
    };

    let normalized_path = normalize_directory_path(directory_path);

    let mut total_removed = 0u64;

    for tag_name in tag_names {
        // find tag by name (case-insensitive)
        let tag_result = sqlx::query_scalar!(
            r#"SELECT id as "id!" FROM tagz WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND deleted_at IS NULL"#,
            tag_name
        )
        .fetch_optional(&pool)
        .await;

        if let Ok(Some(tag_id)) = tag_result {
            let delete_result = sqlx::query!(
                "DELETE FROM directory_tag_rules WHERE directory_path = ? AND tag_id = ?",
                normalized_path,
                tag_id
            )
            .execute(&pool)
            .await;

            if let Ok(result) = delete_result {
                total_removed += result.rows_affected();
            }
        }
    }

    GrimoireResponse::success(
        format!(
            "removed {} tag rules from {}",
            total_removed, normalized_path
        ),
        total_removed,
    )
}

/// clear all tag rules from a directory
pub async fn clear_directory_tags(directory_path: &str) -> GrimoireResponse<u64> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(format!("database connection failed: {}", e), vec![])
        }
    };

    let normalized_path = normalize_directory_path(directory_path);

    let result = sqlx::query!(
        "DELETE FROM directory_tag_rules WHERE directory_path = ?",
        normalized_path
    )
    .execute(&pool)
    .await;

    match result {
        Ok(r) => GrimoireResponse::success(
            format!(
                "cleared {} tag rules from {}",
                r.rows_affected(),
                normalized_path
            ),
            r.rows_affected(),
        ),
        Err(e) => {
            GrimoireResponse::failure(format!("failed to clear directory tags: {}", e), vec![])
        }
    }
}

/// list all directory tag rules
pub async fn list_directory_tag_rules() -> GrimoireResponse<Vec<DirectoryTagRule>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(format!("database connection failed: {}", e), vec![])
        }
    };

    let result = sqlx::query!(
        r#"
        SELECT dtr.id as "id!", dtr.directory_path as "directory_path!",
               dtr.tag_id as "tag_id!", t.name as "tag_name!",
               dtr.created_by, dtr.created_at as "created_at!"
        FROM directory_tag_rules dtr
        JOIN tagz t ON t.id = dtr.tag_id
        ORDER BY dtr.directory_path, t.name
        "#
    )
    .fetch_all(&pool)
    .await;

    match result {
        Ok(rows) => {
            let rules: Vec<DirectoryTagRule> = rows
                .into_iter()
                .map(|row| DirectoryTagRule {
                    id: row.id,
                    directory_path: row.directory_path,
                    tag_id: row.tag_id,
                    tag_name: Some(row.tag_name),
                    created_by: row.created_by,
                    created_at: row.created_at,
                })
                .collect();
            GrimoireResponse::success(format!("found {} directory tag rules", rules.len()), rules)
        }
        Err(e) => {
            GrimoireResponse::failure(format!("failed to list directory tag rules: {}", e), vec![])
        }
    }
}

/// list tag rules for a specific directory path
pub async fn list_directory_tags(directory_path: &str) -> GrimoireResponse<Vec<DirectoryTagRule>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(format!("database connection failed: {}", e), vec![])
        }
    };

    let normalized_path = normalize_directory_path(directory_path);

    let result = sqlx::query!(
        r#"
        SELECT dtr.id as "id!", dtr.directory_path as "directory_path!",
               dtr.tag_id as "tag_id!", t.name as "tag_name!",
               dtr.created_by, dtr.created_at as "created_at!"
        FROM directory_tag_rules dtr
        JOIN tagz t ON t.id = dtr.tag_id
        WHERE dtr.directory_path = ?
        ORDER BY t.name
        "#,
        normalized_path
    )
    .fetch_all(&pool)
    .await;

    match result {
        Ok(rows) => {
            let rules: Vec<DirectoryTagRule> = rows
                .into_iter()
                .map(|row| DirectoryTagRule {
                    id: row.id,
                    directory_path: row.directory_path,
                    tag_id: row.tag_id,
                    tag_name: Some(row.tag_name),
                    created_by: row.created_by,
                    created_at: row.created_at,
                })
                .collect();
            GrimoireResponse::success(
                format!("found {} tag rules for {}", rules.len(), normalized_path),
                rules,
            )
        }
        Err(e) => {
            GrimoireResponse::failure(format!("failed to list directory tags: {}", e), vec![])
        }
    }
}

/// get all tags that should apply to a file at a given path
/// checks all directory tag rules where the file path starts with the rule's directory
pub async fn get_tags_for_file_path(file_path: &str) -> GrimoireResponse<Vec<Tag>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(format!("database connection failed: {}", e), vec![])
        }
    };

    // find all directory rules where file_path starts with directory_path
    // sqlite doesn't have great prefix matching, so we fetch all and filter in rust
    // (for a large number of rules, consider using GLOB or a different approach)
    let result = sqlx::query!(
        r#"
        SELECT DISTINCT t.id as "id!", t.name as "name!", t.created_at as "created_at!"
        FROM directory_tag_rules dtr
        JOIN tagz t ON t.id = dtr.tag_id
        WHERE t.deleted_at IS NULL
        "#
    )
    .fetch_all(&pool)
    .await;

    let all_rules = match sqlx::query!(
        r#"SELECT directory_path as "directory_path!", tag_id as "tag_id!" FROM directory_tag_rules"#
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                format!("failed to get directory tag rules: {}", e),
                vec![],
            );
        }
    };

    // filter rules that match this file path
    let matching_tag_ids: Vec<String> = all_rules
        .into_iter()
        .filter(|rule| file_path.starts_with(&rule.directory_path))
        .map(|rule| rule.tag_id)
        .collect();

    match result {
        Ok(rows) => {
            let tags: Vec<Tag> = rows
                .into_iter()
                .filter(|row| matching_tag_ids.contains(&row.id))
                .map(|row| Tag {
                    id: row.id,
                    name: row.name,
                    created_at: row.created_at,
                })
                .collect();
            GrimoireResponse::success(format!("found {} applicable tags", tags.len()), tags)
        }
        Err(e) => GrimoireResponse::failure(format!("failed to get tags: {}", e), vec![]),
    }
}

/// apply directory tag rules to an album based on its songs' file paths
/// returns the tag ids that were applied
pub async fn apply_directory_tags_to_album(album_id: &str) -> GrimoireResponse<Vec<String>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(format!("database connection failed: {}", e), vec![])
        }
    };

    // get all file paths for songs in this album
    let file_paths_result = sqlx::query_scalar!(
        r#"
        SELECT DISTINCT mb.local_path as "local_path!"
        FROM album_songz als
        JOIN songz s ON s.id = als.song_id
        JOIN media_blobz mb ON mb.id = s.media_blob_id
        WHERE als.album_id = ? AND mb.local_path IS NOT NULL
        "#,
        album_id
    )
    .fetch_all(&pool)
    .await;

    let file_paths = match file_paths_result {
        Ok(paths) => paths,
        Err(e) => {
            return GrimoireResponse::failure(
                format!("failed to get album file paths: {}", e),
                vec![],
            );
        }
    };

    if file_paths.is_empty() {
        return GrimoireResponse::success("no file paths found for album", vec![]);
    }

    // get all directory tag rules
    let rules_result = sqlx::query!(
        r#"SELECT directory_path as "directory_path!", tag_id as "tag_id!" FROM directory_tag_rules"#
    )
    .fetch_all(&pool)
    .await;

    let rules = match rules_result {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                format!("failed to get directory tag rules: {}", e),
                vec![],
            );
        }
    };

    // collect all tags that should apply based on file paths
    let mut tag_ids_to_apply: std::collections::HashSet<String> = std::collections::HashSet::new();

    for file_path in &file_paths {
        for rule in &rules {
            if file_path.starts_with(&rule.directory_path) {
                tag_ids_to_apply.insert(rule.tag_id.clone());
            }
        }
    }

    if tag_ids_to_apply.is_empty() {
        return GrimoireResponse::success("no directory tag rules match album files", vec![]);
    }

    // apply tags to album (INSERT OR IGNORE to avoid duplicates)
    let mut applied = Vec::new();
    for tag_id in tag_ids_to_apply {
        let insert_result = sqlx::query!(
            "INSERT OR IGNORE INTO album_tagz (album_id, tag_id) VALUES (?, ?)",
            album_id,
            tag_id
        )
        .execute(&pool)
        .await;

        if insert_result.is_ok() {
            applied.push(tag_id);
        }
    }

    GrimoireResponse::success(
        format!("applied {} directory-based tags to album", applied.len()),
        applied,
    )
}

/// remove specific tags from all albums under a directory path
/// this operates on actual albums, not just the rules
pub async fn strip_tags_from_directory(
    directory_path: &str,
    tag_names: Vec<String>,
) -> GrimoireResponse<u64> {
    if tag_names.is_empty() {
        return GrimoireResponse::failure("must provide at least one tag name", vec![]);
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(format!("database connection failed: {}", e), vec![])
        }
    };

    let normalized_path = normalize_directory_path(directory_path);

    // find tag ids
    let mut tag_ids = Vec::new();
    for tag_name in &tag_names {
        let tag_result = sqlx::query_scalar!(
            r#"SELECT id as "id!" FROM tagz WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND deleted_at IS NULL"#,
            tag_name
        )
        .fetch_optional(&pool)
        .await;

        if let Ok(Some(tag_id)) = tag_result {
            tag_ids.push(tag_id);
        }
    }

    if tag_ids.is_empty() {
        return GrimoireResponse::success("no matching tags found", 0);
    }

    // find all albums that have songs with files under this directory
    let album_ids_result = sqlx::query_scalar!(
        r#"
        SELECT DISTINCT als.album_id as "album_id!"
        FROM album_songz als
        JOIN songz s ON s.id = als.song_id
        JOIN media_blobz mb ON mb.id = s.media_blob_id
        WHERE mb.local_path LIKE ? || '%'
        "#,
        normalized_path
    )
    .fetch_all(&pool)
    .await;

    let album_ids = match album_ids_result {
        Ok(ids) => ids,
        Err(e) => {
            return GrimoireResponse::failure(format!("failed to find albums: {}", e), vec![]);
        }
    };

    if album_ids.is_empty() {
        return GrimoireResponse::success("no albums found under directory", 0);
    }

    // remove tags from albums
    let mut total_removed = 0u64;
    for album_id in &album_ids {
        for tag_id in &tag_ids {
            let delete_result = sqlx::query!(
                "DELETE FROM album_tagz WHERE album_id = ? AND tag_id = ?",
                album_id,
                tag_id
            )
            .execute(&pool)
            .await;

            if let Ok(result) = delete_result {
                total_removed += result.rows_affected();
            }
        }
    }

    GrimoireResponse::success(
        format!(
            "removed {} tag assignments from {} albums under {}",
            total_removed,
            album_ids.len(),
            normalized_path
        ),
        total_removed,
    )
}

/// clear all rule-based tags from albums under a directory
/// only removes tags that are defined in rules for this directory
pub async fn clear_tags_from_directory(directory_path: &str) -> GrimoireResponse<u64> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(format!("database connection failed: {}", e), vec![])
        }
    };

    let normalized_path = normalize_directory_path(directory_path);

    // get tag ids from rules for this directory
    let tag_ids_result = sqlx::query_scalar!(
        r#"SELECT tag_id as "tag_id!" FROM directory_tag_rules WHERE directory_path = ?"#,
        normalized_path
    )
    .fetch_all(&pool)
    .await;

    let tag_ids = match tag_ids_result {
        Ok(ids) => ids,
        Err(e) => {
            return GrimoireResponse::failure(
                format!("failed to get directory tags: {}", e),
                vec![],
            );
        }
    };

    if tag_ids.is_empty() {
        return GrimoireResponse::success("no tag rules found for directory", 0);
    }

    // find all albums under this directory
    let album_ids_result = sqlx::query_scalar!(
        r#"
        SELECT DISTINCT als.album_id as "album_id!"
        FROM album_songz als
        JOIN songz s ON s.id = als.song_id
        JOIN media_blobz mb ON mb.id = s.media_blob_id
        WHERE mb.local_path LIKE ? || '%'
        "#,
        normalized_path
    )
    .fetch_all(&pool)
    .await;

    let album_ids = match album_ids_result {
        Ok(ids) => ids,
        Err(e) => {
            return GrimoireResponse::failure(format!("failed to find albums: {}", e), vec![]);
        }
    };

    if album_ids.is_empty() {
        return GrimoireResponse::success("no albums found under directory", 0);
    }

    // remove the specific tags from these albums
    let mut total_removed = 0u64;
    for album_id in &album_ids {
        for tag_id in &tag_ids {
            let delete_result = sqlx::query!(
                "DELETE FROM album_tagz WHERE album_id = ? AND tag_id = ?",
                album_id,
                tag_id
            )
            .execute(&pool)
            .await;

            if let Ok(result) = delete_result {
                total_removed += result.rows_affected();
            }
        }
    }

    GrimoireResponse::success(
        format!(
            "cleared {} tag assignments from {} albums under {}",
            total_removed,
            album_ids.len(),
            normalized_path
        ),
        total_removed,
    )
}

/// apply directory tag rules to an album based on a specific file path
/// this is called during import when we know the file path and album
/// returns the tag ids that were applied
pub async fn apply_directory_tags_for_file(
    album_id: &str,
    file_path: &str,
) -> GrimoireResponse<Vec<String>> {
    // get tags that apply to this file path
    let tags_response = get_tags_for_file_path(file_path).await;
    if !tags_response.success {
        return GrimoireResponse::failure(tags_response.message, tags_response.errors);
    }

    let tags = match tags_response.data {
        Some(t) => t,
        None => {
            return GrimoireResponse::success("no directory tag rules apply".to_string(), vec![])
        }
    };

    if tags.is_empty() {
        return GrimoireResponse::success("no directory tag rules apply".to_string(), vec![]);
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(format!("database connection failed: {}", e), vec![])
        }
    };

    let mut applied_tag_ids = Vec::new();

    for tag in &tags {
        // insert into album_tagz if not already present
        let result = sqlx::query!(
            "INSERT OR IGNORE INTO album_tagz (album_id, tag_id) VALUES (?, ?)",
            album_id,
            tag.id
        )
        .execute(&pool)
        .await;

        match result {
            Ok(r) => {
                if r.rows_affected() > 0 {
                    applied_tag_ids.push(tag.id.clone());
                    tracing::debug!(
                        "applied tag '{}' to album {} from directory rules",
                        tag.name,
                        album_id
                    );
                }
            }
            Err(e) => {
                tracing::warn!(
                    "failed to apply tag {} to album {}: {}",
                    tag.id,
                    album_id,
                    e
                );
            }
        }
    }

    GrimoireResponse::success(
        format!(
            "applied {} directory tags to album {}",
            applied_tag_ids.len(),
            album_id
        ),
        applied_tag_ids,
    )
}

/// normalize directory path for consistent storage
/// removes trailing slash (except for root "/")
fn normalize_directory_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed == "/" {
        return "/".to_string();
    }
    trimmed.trim_end_matches('/').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_directory_path() {
        assert_eq!(normalize_directory_path("/Music/jazz/"), "/Music/jazz");
        assert_eq!(normalize_directory_path("/Music/jazz"), "/Music/jazz");
        assert_eq!(normalize_directory_path("/"), "/");
        assert_eq!(normalize_directory_path("  /Music/  "), "/Music");
    }
}
