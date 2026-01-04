//! Example demonstrating smart title construction for music files
//!
//! This example shows how to use the TitleBuilder to create intelligent song titles
//! from various types of metadata and fallback scenarios.
//!
//! Run with: cargo run -p grimoire --example smart_title_builder

use grimoire::music::{AudioMetadata, TitleBuilder, TitleBuilderConfig};
use std::collections::HashMap;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🎵 Smart Title Builder Example");
    println!("==============================\n");

    // Demonstrate different title construction scenarios
    demonstrate_perfect_metadata()?;
    println!();

    demonstrate_missing_artist()?;
    println!();

    demonstrate_filename_fallback()?;
    println!();

    demonstrate_custom_configuration()?;
    println!();

    demonstrate_edge_cases()?;
    println!();

    demonstrate_real_world_scenarios()?;
    println!();

    println!("✅ Smart title builder example completed!");
    Ok(())
}

fn demonstrate_perfect_metadata() -> Result<(), Box<dyn std::error::Error>> {
    println!("🎯 Perfect Metadata Scenarios:");

    let test_cases = vec![
        (
            vec![("Title", "Bohemian Rhapsody"), ("Artist", "Queen")],
            "/music/queen/bohemian_rhapsody.mp3",
            "Classic rock with full metadata",
        ),
        (
            vec![
                ("Title", "The Sound of Silence"),
                ("Artist", "Simon & Garfunkel"),
            ],
            "/music/simon_garfunkel/sound_of_silence.flac",
            "Folk classic with ampersand in artist",
        ),
        (
            vec![("Title", "Stairway to Heaven"), ("Artist", "Led Zeppelin")],
            "/music/led_zeppelin/stairway.wav",
            "Rock epic with abbreviated filename",
        ),
    ];

    let builder = TitleBuilder::new();

    for (tags, file_path, description) in test_cases {
        let metadata = create_metadata(tags, file_path);
        let title = builder.build_title(&metadata);
        println!("  📝 {}: \"{}\"", description, title);
    }

    Ok(())
}

fn demonstrate_missing_artist() -> Result<(), Box<dyn std::error::Error>> {
    println!("🎭 Missing Artist Scenarios:");

    let test_cases = vec![
        (
            vec![("Title", "Für Elise")],
            "/classical/beethoven/fur_elise.mp3",
            "Classical piece (no artist tag)",
        ),
        (
            vec![("Title", "Ambient Soundscape #3")],
            "/ambient/unknown/track03.wav",
            "Ambient track (no artist)",
        ),
        (
            vec![("Title", "   "), ("Artist", "Various Artists")],
            "/compilations/various/track.mp3",
            "Empty title, has artist",
        ),
    ];

    let builder = TitleBuilder::new();

    for (tags, file_path, description) in test_cases {
        let metadata = create_metadata(tags, file_path);
        let title = builder.build_title(&metadata);
        println!("  📝 {}: \"{}\"", description, title);
    }

    Ok(())
}

fn demonstrate_filename_fallback() -> Result<(), Box<dyn std::error::Error>> {
    println!("📁 Filename Fallback Scenarios:");

    let test_cases = vec![
        (
            vec![],
            "/music/downloads/01 - Great Song.mp3",
            "No metadata, track number prefix",
        ),
        (
            vec![],
            "/music/rips/Track 05 - Another Song.flac",
            "No metadata, 'Track' prefix",
        ),
        (
            vec![],
            "/music/collection/song_with_underscores.wav",
            "No metadata, underscores in filename",
        ),
        (
            vec![],
            "/music/albums/1. First Track.m4a",
            "No metadata, numbered list format",
        ),
        (
            vec![],
            "/music/various/Some   Song   With   Spaces.ogg",
            "No metadata, multiple spaces",
        ),
    ];

    let builder = TitleBuilder::new();

    for (tags, file_path, description) in test_cases {
        let metadata = create_metadata(tags, file_path);
        let title = builder.build_title(&metadata);
        println!("  📝 {}: \"{}\"", description, title);
    }

    Ok(())
}

fn demonstrate_custom_configuration() -> Result<(), Box<dyn std::error::Error>> {
    println!("⚙️  Custom Configuration Scenarios:");

    // Configuration 1: Different separator
    let mut config1 = TitleBuilderConfig::default();
    config1.artist_separator = " by ".to_string();
    let builder1 = TitleBuilder::with_config(config1);

    let metadata1 = create_metadata(
        vec![("Title", "Yesterday"), ("Artist", "The Beatles")],
        "/music/beatles/yesterday.mp3",
    );
    let title1 = builder1.build_title(&metadata1);
    println!("  📝 Custom separator (\" by \"): \"{}\"", title1);

    // Configuration 2: No artist included
    let mut config2 = TitleBuilderConfig::default();
    config2.include_artist = false;
    let builder2 = TitleBuilder::with_config(config2);

    let title2 = builder2.build_title(&metadata1);
    println!("  📝 No artist included: \"{}\"", title2);

    // Configuration 3: Length limit
    let mut config3 = TitleBuilderConfig::default();
    config3.max_length = Some(20);
    let builder3 = TitleBuilder::with_config(config3);

    let metadata3 = create_metadata(
        vec![
            ("Title", "Supercalifragilisticexpialidocious"),
            ("Artist", "Mary Poppins Original Cast"),
        ],
        "/music/soundtracks/mary_poppins.mp3",
    );
    let title3 = builder3.build_title(&metadata3);
    println!("  📝 Length limited (20 chars): \"{}\"", title3);

    // Configuration 4: Custom tag priority
    let mut config4 = TitleBuilderConfig::default();
    config4.title_tag_priority = vec!["TrackTitle".to_string(), "Title".to_string()];
    config4.artist_tag_priority = vec!["AlbumArtist".to_string(), "Artist".to_string()];
    let builder4 = TitleBuilder::with_config(config4);

    let metadata4 = create_metadata(
        vec![
            ("Title", "Wrong Title"),
            ("TrackTitle", "Correct Title"),
            ("Artist", "Wrong Artist"),
            ("AlbumArtist", "Correct Artist"),
        ],
        "/music/test.mp3",
    );
    let title4 = builder4.build_title(&metadata4);
    println!("  📝 Custom tag priority: \"{}\"", title4);

    Ok(())
}

fn demonstrate_edge_cases() -> Result<(), Box<dyn std::error::Error>> {
    println!("🚨 Edge Cases:");

    let test_cases = vec![
        (
            vec![("Title", ""), ("Artist", "")],
            "/",
            "Empty tags, root path",
        ),
        (
            vec![("TITLE", "UPPERCASE TITLE"), ("artist", "lowercase artist")],
            "/music/mixed_case.mp3",
            "Mixed case tags",
        ),
        (
            vec![
                ("Title", "  \t Whitespace Song  \n"),
                ("Artist", " \t Spaced Artist \r"),
            ],
            "/music/whitespace.mp3",
            "Whitespace in tags",
        ),
        (
            vec![("Title", "Song"), ("Artist", "Artist")],
            "",
            "Empty file path",
        ),
    ];

    let builder = TitleBuilder::new();

    for (tags, file_path, description) in test_cases {
        let metadata = create_metadata(tags, file_path);
        let title = builder.build_title(&metadata);
        println!("  📝 {}: \"{}\"", description, title);
    }

    Ok(())
}

fn demonstrate_real_world_scenarios() -> Result<(), Box<dyn std::error::Error>> {
    println!("🌍 Real-World Scenarios:");

    let real_world_cases = vec![
        (
            vec![("Title", "03 Gymnopédie No. 1"), ("Artist", "Erik Satie")],
            "/music/classical/satie/gymnopedie_1.mp3",
            "Classical with accents and numbers",
        ),
        (
            vec![("Title", "Love Is All You Need"), ("Artist", "The Beatles")],
            "/music/beatles/1967 - Sgt Pepper/08 - All You Need Is Love.flac",
            "Album structure with year",
        ),
        (
            vec![],
            "/downloads/music/[1995] Radiohead - The Bends - 03 - High and Dry.mp3",
            "Download with full info in filename",
        ),
        (
            vec![("Title", "Clair de Lune"), ("Artist", "Claude Debussy")],
            "/music/debussy/suite_bergamasque/03_clair_de_lune.wav",
            "Classical composer as artist",
        ),
        (
            vec![("Title", "Track 1"), ("Artist", "Unknown Artist")],
            "/ripped_cds/cd_01/track_01.wav",
            "Generic ripped CD track",
        ),
        (
            vec![("Title", "マツケンサンバII"), ("Artist", "松平健")],
            "/music/japanese/matsuken_samba.mp3",
            "Japanese characters",
        ),
    ];

    let builder = TitleBuilder::new();

    for (tags, file_path, description) in real_world_cases {
        let metadata = create_metadata(tags, file_path);
        let title = builder.build_title(&metadata);
        println!("  📝 {}: \"{}\"", description, title);
    }

    Ok(())
}

fn create_metadata(tags: Vec<(&str, &str)>, file_path: &str) -> AudioMetadata {
    let mut tag_map = HashMap::new();
    for (key, value) in tags {
        tag_map.insert(key.to_string(), value.to_string());
    }
    AudioMetadata::new(tag_map, file_path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_example_runs_without_panic() {
        // This test ensures the example can run without panicking
        main().expect("Example should run successfully");
    }

    #[test]
    fn test_metadata_creation_helper() {
        let metadata = create_metadata(vec![("Title", "Test"), ("Artist", "Tester")], "/test.mp3");

        assert_eq!(metadata.get_tag("Title"), Some(&"Test".to_string()));
        assert_eq!(metadata.get_tag("Artist"), Some(&"Tester".to_string()));
        assert_eq!(metadata.file_path, "/test.mp3");
    }

    #[test]
    fn test_comprehensive_title_scenarios() {
        let builder = TitleBuilder::new();

        // Test perfect case
        let perfect = create_metadata(
            vec![("Title", "Perfect Song"), ("Artist", "Perfect Artist")],
            "/music/perfect.mp3",
        );
        assert_eq!(
            builder.build_title(&perfect),
            "Perfect Song - Perfect Artist"
        );

        // Test filename fallback
        let fallback = create_metadata(vec![], "/music/01 - Fallback Song.mp3");
        assert_eq!(builder.build_title(&fallback), "Fallback Song");

        // Test edge case
        let edge_case = create_metadata(vec![], "/");
        assert_eq!(builder.build_title(&edge_case), "/");
    }
}
