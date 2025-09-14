//! Shared sorting utilities for music/media domain
//!
//! This module provides common sorting functionality that can be used
//! across different endpoints in the media domain, ensuring consistency
//! in how sorting is handled between the songs API and search API.

// Note: SongQuery uses string-based ordering, not enum-based

/// Validate if a sort field is supported for string-based ordering
///
/// # Arguments
/// * `field` - The field name as a string (e.g., "title", "artist")
///
/// # Returns
/// * `Some(field)` if the field is recognized and supported
/// * `None` if the field is not supported
///
/// # Example
/// ```
/// use crate::media::sorting::validate_sort_field;
///
/// assert_eq!(validate_sort_field("title"), Some("title"));
/// assert_eq!(validate_sort_field("unknown"), None);
/// ```
pub fn validate_sort_field(field: &str) -> Option<&str> {
    match field {
        "title" | "artist" | "album" | "rating" | "user_rating" | "user_is_favorite" | "year"
        | "duration_seconds" | "created_at" | "updated_at" => Some(field),
        _ => None,
    }
}

/// Validate and normalize sort direction string
///
/// # Arguments
/// * `direction` - The direction as a string ("asc" or "desc")
///
/// # Returns
/// * `"asc"` for "asc" (case insensitive)
/// * `"desc"` for anything else (default)
///
/// # Example
/// ```
/// use crate::media::sorting::normalize_sort_direction;
///
/// assert_eq!(normalize_sort_direction("asc"), "asc");
/// assert_eq!(normalize_sort_direction("DESC"), "desc");
/// assert_eq!(normalize_sort_direction("invalid"), "desc");
/// ```
pub fn normalize_sort_direction(direction: &str) -> &'static str {
    match direction.to_lowercase().as_str() {
        "asc" => "asc",
        _ => "desc", // Default to descending for any unrecognized value
    }
}

/// List of supported sort fields for music/media content
///
/// This can be used for validation, API documentation, or UI generation
pub const SUPPORTED_SORT_FIELDS: &[&str] = &[
    "title",
    "artist",
    "album",
    "rating",
    "user_rating",
    "user_is_favorite",
    "year",
    "duration_seconds",
    "created_at",
    "updated_at",
];

/// Validate if a sort field is supported
///
/// # Arguments
/// * `field` - The field name to validate
///
/// # Returns
/// * `true` if the field is supported for sorting
/// * `false` if the field is not supported
pub fn is_supported_sort_field(field: &str) -> bool {
    SUPPORTED_SORT_FIELDS.contains(&field)
}

/// Default sorting configuration for music content
pub const DEFAULT_SORT_FIELD: &str = "created_at";
pub const DEFAULT_SORT_DIRECTION: &str = "desc";

/// Get default sort field
pub fn get_default_sort_field() -> &'static str {
    DEFAULT_SORT_FIELD
}

/// Get default sort direction
pub fn get_default_sort_direction() -> &'static str {
    DEFAULT_SORT_DIRECTION
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_sort_field() {
        // Test valid fields
        assert_eq!(validate_sort_field("title"), Some("title"));
        assert_eq!(validate_sort_field("artist"), Some("artist"));
        assert_eq!(validate_sort_field("album"), Some("album"));
        assert_eq!(validate_sort_field("rating"), Some("rating"));
        assert_eq!(validate_sort_field("year"), Some("year"));
        assert_eq!(
            validate_sort_field("duration_seconds"),
            Some("duration_seconds")
        );
        assert_eq!(validate_sort_field("created_at"), Some("created_at"));
        assert_eq!(validate_sort_field("updated_at"), Some("updated_at"));

        // Test invalid fields
        assert_eq!(validate_sort_field("invalid_field"), None);
        assert_eq!(validate_sort_field(""), None);
    }

    #[test]
    fn test_normalize_sort_direction() {
        // Test valid directions
        assert_eq!(normalize_sort_direction("asc"), "asc");
        assert_eq!(normalize_sort_direction("ASC"), "asc");
        assert_eq!(normalize_sort_direction("desc"), "desc");
        assert_eq!(normalize_sort_direction("DESC"), "desc");

        // Test default behavior
        assert_eq!(normalize_sort_direction(""), "desc");
        assert_eq!(normalize_sort_direction("invalid"), "desc");
    }

    #[test]
    fn test_is_supported_sort_field() {
        // Test supported fields
        assert!(is_supported_sort_field("title"));
        assert!(is_supported_sort_field("artist"));
        assert!(is_supported_sort_field("year"));
        assert!(is_supported_sort_field("duration_seconds"));

        // Test unsupported fields
        assert!(!is_supported_sort_field("invalid_field"));
        assert!(!is_supported_sort_field(""));
    }

    #[test]
    fn test_validate_sort_field_comprehensive() {
        // Test all supported fields
        for &field in SUPPORTED_SORT_FIELDS.iter() {
            assert!(is_supported_sort_field(field));
            assert!(validate_sort_field(field).is_some());
        }

        // Test invalid fields
        assert!(!is_supported_sort_field("invalid_field"));
        assert!(validate_sort_field("invalid_field").is_none());
    }

    #[test]
    fn test_defaults() {
        assert_eq!(get_default_sort_field(), "created_at");
        assert_eq!(get_default_sort_direction(), "desc");
    }
}
