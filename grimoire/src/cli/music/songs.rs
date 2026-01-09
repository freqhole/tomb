//! Music song commands

use super::MusicAction;
use crate::cli::utils::resolve_request;
use crate::error::GrimoireResult;
use crate::music::crud::{list_recent_songs, update_songs};

pub async fn handle_recent_songs(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::RecentSongs { limit } = action {
        println!("listing recent songs...");
        match list_recent_songs(Some(limit as u32)).await {
            Ok(result) => {
                println!("found {} recent songs", result.items.len());
                for song in result.items {
                    println!(
                        "  {} - {} ({})",
                        song.artist
                            .as_ref()
                            .map(|a| a.name.clone())
                            .unwrap_or("Unknown".to_string()),
                        song.song.title,
                        song.album
                            .as_ref()
                            .map(|a| a.title.clone())
                            .unwrap_or("No Album".to_string())
                    );
                }
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to list recent songs: {}", e);
                Err(e.into())
            }
        }
    } else {
        unreachable!("handle_recent_songs called with wrong action variant")
    }
}

pub async fn handle_update_songs(
    action: MusicAction,
    format: crate::cli::output::OutputFormat,
) -> GrimoireResult<()> {
    if let MusicAction::UpdateSongs {
        json_input,
        request,
    } = action
    {
        // Resolve input: JSON takes precedence over flattened fields
        let req = resolve_request(json_input, request)?.normalize();

        // Execute update
        let result = update_songs(req).await?;

        match format {
            crate::cli::output::OutputFormat::Default => {
                // Build human-readable message
                println!("Updated {} song(s)", result.songs_updated);

                if let Some(ref artist) = result.artist {
                    println!("  artist: {}", artist.name);
                }
                if let Some(ref album) = result.album {
                    println!("  album: {}", album.title);
                }
                if let Some(ref genre) = result.genre {
                    println!("  genre: {}", genre.name);
                }
                if let Some(ref sub_genre) = result.sub_genre {
                    println!("  sub-genre: {}", sub_genre.name);
                }
                if let Some(ref thumbnail_id) = result.thumbnail_blob_id {
                    println!("  thumbnail: {}", thumbnail_id);
                }
                if result.tags_modified {
                    println!("  tags modified");
                }
                if !result.songs_failed.is_empty() {
                    println!("Failed to update {} song(s):", result.songs_failed.len());
                    for (song_id, error) in &result.songs_failed {
                        println!("  {}: {}", song_id, error);
                    }
                }
            }
            crate::cli::output::OutputFormat::Json => {
                let mut messages = vec![format!("Updated {} song(s)", result.songs_updated)];

                if let Some(ref artist) = result.artist {
                    messages.push(format!("artist: {}", artist.name));
                }
                if let Some(ref album) = result.album {
                    messages.push(format!("album: {}", album.title));
                }
                if let Some(ref genre) = result.genre {
                    messages.push(format!("genre: {}", genre.name));
                }
                if let Some(ref sub_genre) = result.sub_genre {
                    messages.push(format!("sub-genre: {}", sub_genre.name));
                }
                if let Some(ref thumbnail_id) = result.thumbnail_blob_id {
                    messages.push(format!("thumbnail: {}", thumbnail_id));
                }
                if result.tags_modified {
                    messages.push("tags modified".to_string());
                }
                if !result.songs_failed.is_empty() {
                    messages.push(format!(
                        "Failed to update {} song(s)",
                        result.songs_failed.len()
                    ));
                }

                let output = serde_json::json!({
                    "messages": messages,
                    "data": result,
                });
                println!("{}", serde_json::to_string_pretty(&output).unwrap());
            }
        }

        Ok(())
    } else {
        unreachable!("handle_update_songs called with wrong action variant")
    }
}
