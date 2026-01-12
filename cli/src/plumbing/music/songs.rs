//! Music song commands

use super::MusicAction;
use grimoire::plumbing::utils::resolve_request;
use grimoire::plumbing::utils::CommandOutput;
use grimoire::music::crud::UpdateSongsRequest;
use grimoire::music::crud::{list_recent_songs, update_songs};

pub async fn handle_recent_songs(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::RecentSongs { limit } = action {
        let response = list_recent_songs(Some(limit as u32)).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(result) = response.data else {
            return CommandOutput::failure("No recent songs returned", vec![], ());
        };

        let message = format!("found {} recent songs", result.items.len());
        CommandOutput::success(message, result)
    } else {
        unreachable!("handle_recent_songs called with wrong action variant")
    }
}

pub async fn handle_update_songs(action: MusicAction) -> CommandOutput<serde_json::Value> {
    if let MusicAction::UpdateSongs {
        json_input,
        request,
    } = action
    {
        // Resolve input: JSON takes precedence over flattened fields
        let req = match resolve_request::<UpdateSongsRequest>(json_input, request) {
            Ok(r) => r.normalize(),
            Err(e) => {
                return CommandOutput::failure(
                    "Invalid request",
                    vec![crate::error::ErrorDetail::from(&e)],
                    (),
                );
            }
        };

        // Execute update
        let response = update_songs(req).await;
        if !response.success {
            return CommandOutput::failure(response.message, response.errors, ());
        }

        let Some(result) = response.data else {
            return CommandOutput::failure("No update results returned", vec![], ());
        };

        let message = format!("Updated {} song(s)", result.songs_updated);
        CommandOutput::success(message, result)
    } else {
        unreachable!("handle_update_songs called with wrong action variant")
    }
}
