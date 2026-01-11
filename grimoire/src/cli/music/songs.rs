//! Music song commands

use super::MusicAction;
use crate::cli::utils::resolve_request;
use crate::cli::utils::CommandOutput;
use crate::error::{GrimoireError, GrimoireResult};
use crate::music::crud::{
    list_recent_songs, update_songs, QueryResult, SongQueryResult, UpdateSongsResult,
};
use crate::response::GrimoireResponse;

// Temporary adapter to convert GrimoireResponse to Result for CLI compatibility
// TODO: Phase 5 will update CLI to use GrimoireResponse directly
fn to_result<T>(response: GrimoireResponse<T>) -> GrimoireResult<T> {
    if response.success {
        response
            .data
            .ok_or_else(|| GrimoireError::ProcessingFailed {
                message: "Response succeeded but contained no data".to_string(),
            })
    } else {
        let error_messages: Vec<String> =
            response.errors.iter().map(|e| e.detail.clone()).collect();
        Err(GrimoireError::ProcessingFailed {
            message: format!("{}: {}", response.message, error_messages.join(", ")),
        })
    }
}

pub async fn handle_recent_songs(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<QueryResult<SongQueryResult>>> {
    if let MusicAction::RecentSongs { limit } = action {
        let result = to_result(list_recent_songs(Some(limit as u32)).await)?;

        let message = format!("found {} recent songs", result.items.len());
        Ok(CommandOutput::new(message, result))
    } else {
        unreachable!("handle_recent_songs called with wrong action variant")
    }
}

pub async fn handle_update_songs(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<UpdateSongsResult>> {
    if let MusicAction::UpdateSongs {
        json_input,
        request,
    } = action
    {
        // Resolve input: JSON takes precedence over flattened fields
        let req = resolve_request(json_input, request)?.normalize();

        // Execute update
        let result = to_result(update_songs(req).await)?;

        let message = format!("Updated {} song(s)", result.songs_updated);
        Ok(CommandOutput::new(message, result))
    } else {
        unreachable!("handle_update_songs called with wrong action variant")
    }
}
