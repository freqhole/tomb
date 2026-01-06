//! deduplication helpers for case-insensitive matching
//! provides utilities to prevent duplicate artists, albums, and genres

use crate::error::GrimoireResult;

/// normalize a name for case-insensitive matching
/// trims whitespace, converts to lowercase, collapses multiple spaces
pub fn normalize_name(input: &str) -> String {
    input
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// normalize artist name with music-specific rules
pub fn normalize_artist_name(input: &str) -> String {
    let normalized = normalize_name(input);

    // TODO: add music-specific normalization rules
    // - Handle "The Beatles" vs "Beatles, The"
    // - Handle feat./featuring variations
    // - Handle punctuation differences ("Guns N' Roses" vs "Guns N Roses")

    normalized
}

/// normalize album title with music-specific rules
pub fn normalize_album_title(input: &str) -> String {
    let normalized = normalize_name(input);

    // TODO: add album-specific normalization rules
    // - Handle "Greatest Hits" variations
    // - Handle edition markers "(Deluxe)", "[Remastered]"
    // - Handle year suffixes

    normalized
}

/// normalize genre name for consistent categorization
pub fn normalize_genre_name(input: &str) -> String {
    let normalized = normalize_name(input);

    // TODO: add genre-specific normalization rules
    // - Handle plural/singular variations ("Rock" vs "Rocks")
    // - Handle hyphenation differences ("Hip-Hop" vs "Hip Hop")
    // - Handle abbreviations ("R&B" vs "Rhythm and Blues")

    normalized
}

/// check if two artist names should be considered the same
pub fn artists_match(name1: &str, name2: &str) -> bool {
    normalize_artist_name(name1) == normalize_artist_name(name2)
}

/// check if two album titles should be considered the same
pub fn albums_match(title1: &str, title2: &str) -> bool {
    normalize_album_title(title1) == normalize_album_title(title2)
}

/// check if two genre names should be considered the same
pub fn genres_match(name1: &str, name2: &str) -> bool {
    normalize_genre_name(name1) == normalize_genre_name(name2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_name() {
        assert_eq!(normalize_name("  The Beatles  "), "the beatles");
        assert_eq!(normalize_name("Guns N'   Roses"), "guns n' roses");
        assert_eq!(normalize_name("RADIOHEAD"), "radiohead");
        assert_eq!(normalize_name(""), "");
    }

    #[test]
    fn test_artists_match() {
        assert!(artists_match("The Beatles", "the beatles"));
        assert!(artists_match("RADIOHEAD", "Radiohead"));
        assert!(artists_match("  Pink Floyd  ", "Pink Floyd"));
        assert!(!artists_match("The Beatles", "Beatles"));
    }

    #[test]
    fn test_albums_match() {
        assert!(albums_match("OK Computer", "ok computer"));
        assert!(albums_match("Abbey Road", "ABBEY ROAD"));
        assert!(!albums_match("Abbey Road", "Sgt. Pepper"));
    }

    #[test]
    fn test_genres_match() {
        assert!(genres_match("Rock", "rock"));
        assert!(genres_match("Hip-Hop", "hip-hop"));
        assert!(!genres_match("Rock", "Pop"));
    }
}
