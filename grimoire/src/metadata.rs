//! metadata helper functions for working with json metadata columns
//!
//! provides utilities for merging metadata updates instead of overwriting,
//! preventing data loss when updating json blob columns

use sqlx::SqlitePool;

/// merge new metadata into existing metadata using json_patch
///
/// this ensures existing keys are preserved when adding/updating fields
///
/// # examples
///
/// ```ignore
/// let existing = json!({"file_modified_at": 123456, "other": "value"});
/// let updates = json!({"new_field": "new_value"});
/// let merged = merge_metadata(&existing, &updates);
/// // result: {"file_modified_at": 123456, "other": "value", "new_field": "new_value"}
/// ```
pub fn merge_metadata(
    existing: &serde_json::Value,
    updates: &serde_json::Value,
) -> serde_json::Value {
    // if either is null or not an object, just return updates
    if !existing.is_object() || !updates.is_object() {
        return updates.clone();
    }

    let mut result = existing.clone();
    if let (Some(result_obj), Some(updates_obj)) = (result.as_object_mut(), updates.as_object()) {
        for (key, value) in updates_obj {
            result_obj.insert(key.clone(), value.clone());
        }
    }

    result
}

/// update metadata on media_blobz table with automatic merging
///
/// uses sqlite's json_patch() to merge updates into existing metadata
/// without overwriting existing keys
pub async fn update_media_blob_metadata(
    pool: &SqlitePool,
    blob_id: &str,
    updates: &serde_json::Value,
) -> Result<(), sqlx::Error> {
    let updates_str = serde_json::to_string(updates).unwrap_or_else(|_| "{}".to_string());

    sqlx::query!(
        r#"
        UPDATE media_blobz
        SET metadata = json_patch(COALESCE(metadata, '{}'), ?)
        WHERE id = ?
        "#,
        updates_str,
        blob_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// update metadata on songz table with automatic merging
pub async fn update_song_metadata(
    pool: &SqlitePool,
    song_id: &str,
    updates: &serde_json::Value,
) -> Result<(), sqlx::Error> {
    let updates_str = serde_json::to_string(updates).unwrap_or_else(|_| "{}".to_string());

    sqlx::query!(
        r#"
        UPDATE songz
        SET metadata = json_patch(COALESCE(metadata, '{}'), ?)
        WHERE id = ?
        "#,
        updates_str,
        song_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_merge_metadata_preserves_existing_keys() {
        let existing = json!({
            "file_modified_at": 123456,
            "file_size": 1024,
            "other": "value"
        });

        let updates = json!({
            "new_field": "new_value",
            "file_size": 2048  // update existing key
        });

        let result = merge_metadata(&existing, &updates);

        assert_eq!(result["file_modified_at"], 123456); // preserved
        assert_eq!(result["file_size"], 2048); // updated
        assert_eq!(result["other"], "value"); // preserved
        assert_eq!(result["new_field"], "new_value"); // added
    }

    #[test]
    fn test_merge_metadata_handles_empty_existing() {
        let existing = json!({});
        let updates = json!({"new_field": "value"});

        let result = merge_metadata(&existing, &updates);

        assert_eq!(result["new_field"], "value");
    }

    #[test]
    fn test_merge_metadata_handles_null_existing() {
        let existing = serde_json::Value::Null;
        let updates = json!({"new_field": "value"});

        let result = merge_metadata(&existing, &updates);

        assert_eq!(result, updates);
    }
}
