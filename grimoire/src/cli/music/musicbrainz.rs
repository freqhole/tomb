//! MusicBrainz API integration commands

use crate::error::GrimoireResult;
use crate::music::musicbrainz::{
    MusicBrainzClient, MusicBrainzConfig, RecordingSearchQuery, ReleaseSearchQuery,
};
use clap::Subcommand;

#[derive(Subcommand)]
pub enum MusicBrainzAction {
    /// Search MusicBrainz for song/recording
    SearchSong {
        /// Song title
        #[arg(long)]
        title: String,
        /// Artist name
        #[arg(long)]
        artist: Option<String>,
        /// Album name
        #[arg(long)]
        album: Option<String>,
        /// Maximum number of results
        #[arg(long, default_value = "10")]
        limit: usize,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Search MusicBrainz for album/release
    SearchAlbum {
        /// Search query
        #[arg(long)]
        query: Option<String>,
        /// Artist name
        #[arg(long)]
        artist: Option<String>,
        /// Album name
        #[arg(long)]
        album: Option<String>,
        /// Maximum number of results
        #[arg(long, default_value = "10")]
        limit: usize,
        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
    /// Get recording details by MusicBrainz ID
    GetRecording { recording_id: String },
    /// Get release details by MusicBrainz ID
    GetRelease { release_id: String },
    /// Get cover art for a release
    GetCoverArt { release_id: String },
    /// Search for album with cover art
    SearchAlbumWithArt {
        /// Search query
        #[arg(long)]
        query: Option<String>,
        /// Artist name
        #[arg(long)]
        artist: Option<String>,
        /// Album name
        #[arg(long)]
        album: Option<String>,
        /// Maximum number of results
        #[arg(long, default_value = "5")]
        limit: usize,
    },
    /// Test MusicBrainz configuration
    TestConfig,
}

/// Handle MusicBrainz commands
pub async fn handle_command(action: MusicBrainzAction) -> GrimoireResult<()> {
    // Create client with config (enabled for testing)
    let mut config = MusicBrainzConfig::default();
    config.enabled = true;

    let client = MusicBrainzClient::new(config).map_err(|e| {
        crate::error::GrimoireError::ProcessingFailed {
            message: format!("Failed to create MusicBrainz client: {}", e),
        }
    })?;

    match action {
        MusicBrainzAction::SearchSong {
            title,
            artist,
            album,
            limit,
            json,
        } => {
            println!("Searching MusicBrainz for song: {}", title);

            let mut query = RecordingSearchQuery::new()
                .title(&title)
                .limit(limit as u32);

            if let Some(artist) = artist {
                query = query.artist(&artist);
            }

            if let Some(album) = album {
                query = query.release(&album);
            }

            match client.search_recordings(&query).await {
                Ok(results) => {
                    if json {
                        println!("{}", serde_json::to_string_pretty(&results).unwrap());
                    } else {
                        println!(
                            "Found {} recordings (total: {})",
                            results.results.len(),
                            results.count
                        );
                        for (i, recording) in results.results.iter().enumerate() {
                            println!(
                                "\n[{}] {} - {}",
                                i + 1,
                                recording
                                    .primary_artist_name()
                                    .unwrap_or_else(|| "Unknown".to_string()),
                                recording.title
                            );
                            println!("    ID: {}", recording.id);
                            if let Some(length) = recording.length {
                                println!(
                                    "    Duration: {}:{:02}",
                                    length / 60000,
                                    (length / 1000) % 60
                                );
                            }
                            if let Some(score) = recording.score {
                                println!("    Score: {}", score);
                            }
                            if let Some(releases) = &recording.releases {
                                if let Some(release) = releases.first() {
                                    println!("    Release: {}", release.title);
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Failed to search recordings: {}", e);
                }
            }
        }
        MusicBrainzAction::SearchAlbum {
            query: query_text,
            artist,
            album,
            limit,
            json,
        } => {
            let mut query = ReleaseSearchQuery::new().limit(limit as u32);

            if let Some(q) = query_text {
                // Free-form search
                println!("Searching MusicBrainz for: {}", q);
                query = query.param("query", q);
            } else if let (Some(artist), Some(album)) = (&artist, &album) {
                // Explicit artist/album search
                println!("Searching MusicBrainz for album: {} by {}", album, artist);
                query = query.artist(artist).release(album);
            } else {
                eprintln!("Error: Must provide either --query OR both --artist and --album");
                return Ok(());
            }

            match client.search_releases(&query).await {
                Ok(results) => {
                    if json {
                        println!("{}", serde_json::to_string_pretty(&results).unwrap());
                    } else {
                        println!(
                            "Found {} releases (total: {})",
                            results.results.len(),
                            results.count
                        );
                        for (i, release) in results.results.iter().enumerate() {
                            println!(
                                "\n[{}] {} - {}",
                                i + 1,
                                release
                                    .primary_artist_name()
                                    .unwrap_or_else(|| "Unknown".to_string()),
                                release.title
                            );
                            println!("    ID: {}", release.id);
                            if let Some(date) = &release.date {
                                println!("    Date: {}", date);
                            }
                            if let Some(country) = &release.country {
                                println!("    Country: {}", country);
                            }
                            if let Some(score) = release.score {
                                println!("    Score: {}", score);
                            }

                            // Show cover art info
                            if release.has_cover_art() {
                                println!(
                                    "    Cover Art: ✓ ({} images available)",
                                    release.cover_art_count()
                                );
                                if release.has_front_cover() {
                                    println!("    Front Cover: ✓");
                                }
                            } else {
                                println!("    Cover Art: ✗");
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Failed to search releases: {}", e);
                }
            }
        }
        MusicBrainzAction::GetRecording { recording_id } => {
            println!("Fetching recording: {}", recording_id);

            match client.get_recording(&recording_id).await {
                Ok(recording) => {
                    println!("{}", serde_json::to_string_pretty(&recording).unwrap());
                }
                Err(e) => {
                    eprintln!("Failed to fetch recording: {}", e);
                }
            }
        }
        MusicBrainzAction::GetRelease { release_id } => {
            println!("Fetching release: {}", release_id);

            match client.get_release(&release_id).await {
                Ok(release) => {
                    println!("{}", serde_json::to_string_pretty(&release).unwrap());
                }
                Err(e) => {
                    eprintln!("Failed to fetch release: {}", e);
                }
            }
        }
        MusicBrainzAction::GetCoverArt { release_id } => {
            println!("Fetching cover art for release: {}", release_id);

            match client.get_cover_art(&release_id).await {
                Ok(cover_arts) => {
                    println!("Found {} cover art images:\n", cover_arts.len());
                    for (i, art) in cover_arts.iter().enumerate() {
                        println!("[{}] ID: {}", i + 1, art.id);
                        println!("    Types: {}", art.types.join(", "));
                        println!("    Front: {}, Back: {}", art.front, art.back);
                        println!("    Approved: {}", art.approved);
                        println!("    Full URL: {}", art.image_url);
                        println!("    Thumbnail: {}", art.thumbnail_url());
                        println!("    Large Thumbnail: {}", art.large_thumbnail_url());
                        if let Some(comment) = &art.comment {
                            println!("    Comment: {}", comment);
                        }
                        println!();
                    }
                }
                Err(e) => {
                    eprintln!("Failed to fetch cover art: {}", e);
                }
            }
        }
        MusicBrainzAction::SearchAlbumWithArt {
            query: query_text,
            artist,
            album,
            limit,
        } => {
            let mut query = ReleaseSearchQuery::new().limit(limit as u32);

            if let Some(q) = query_text {
                // Free-form search
                println!("Searching MusicBrainz for: {}", q);
                query = query.param("query", q);
            } else if let (Some(artist), Some(album)) = (&artist, &album) {
                // Explicit artist/album search
                println!(
                    "Searching MusicBrainz for album with cover art: {} by {}",
                    album, artist
                );
                query = query.artist(artist).release(album);
            } else {
                eprintln!("Error: Must provide either --query OR both --artist and --album");
                return Ok(());
            }

            println!("(This will fetch cover art for each result - may take a moment...)\n");

            match client.search_releases_with_cover_art(&query).await {
                Ok(results) => {
                    println!("Found {} releases:\n", results.len());
                    for (i, (release, cover_arts)) in results.iter().enumerate() {
                        println!(
                            "[{}] {} - {}",
                            i + 1,
                            release
                                .primary_artist_name()
                                .unwrap_or_else(|| "Unknown".to_string()),
                            release.title
                        );
                        println!("    ID: {}", release.id);
                        if let Some(date) = &release.date {
                            println!("    Date: {}", date);
                        }
                        if let Some(country) = &release.country {
                            println!("    Country: {}", country);
                        }

                        // Show cover art info
                        if cover_arts.is_empty() {
                            println!("    Cover Art: ✗ (none available)");
                        } else {
                            println!("    Cover Art: ✓ ({} images)", cover_arts.len());

                            // Show front cover if available
                            if let Some(front) = cover_arts.iter().find(|a| a.is_front()) {
                                println!("    Front Cover:");
                                println!("      Thumbnail: {}", front.thumbnail_url());
                                println!("      Full Size: {}", front.image_url);
                            }

                            // Show count of other types
                            let backs = cover_arts.iter().filter(|a| a.is_back()).count();
                            let others = cover_arts.len()
                                - cover_arts.iter().filter(|a| a.is_front()).count()
                                - backs;

                            if backs > 0 {
                                println!("    Back Covers: {}", backs);
                            }
                            if others > 0 {
                                println!("    Other Images: {}", others);
                            }
                        }
                        println!();
                    }

                    // Show how to get full details
                    println!(
                        "TIP: Use 'get-cover-art <release-id>' to see all images for a release"
                    );
                }
                Err(e) => {
                    eprintln!("Failed to search releases with cover art: {}", e);
                }
            }
        }
        MusicBrainzAction::TestConfig => {
            println!("Testing MusicBrainz configuration...");
            println!("Enabled: {}", client.config().enabled);
            println!("Base URL: {}", client.config().base_url);
            println!("Cover Art URL: {}", client.config().cover_art_url);
            println!("Rate Limit: {}ms", client.config().rate_limit_ms);
            println!("User Agent: {}", client.config().user_agent);
            println!("\nConfiguration is valid! ✓");

            // Test rate limiter
            println!("\nTesting rate limiter...");
            let can_proceed = client.can_make_request().await;
            println!("Can make request immediately: {}", can_proceed);

            let time_until = client.time_until_next_request().await;
            println!("Time until next request: {:?}", time_until);
        }
    }

    Ok(())
}
