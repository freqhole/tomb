//! Music song commands

use super::MusicAction;
use crate::cli::output::CommandOutput;
use crate::cli::utils::resolve_request;
use crate::error::GrimoireResult;
use crate::music::crud::{
    list_recent_songs, update_songs, QueryResult, SongQueryResult, UpdateSongsResult,
};

pub async fn handle_recent_songs(
    action: MusicAction,
) -> GrimoireResult<CommandOutput<QueryResult<SongQueryResult>>> {
    if let MusicAction::RecentSongs { limit } = action {
        let result = list_recent_songs(Some(limit as u32)).await?;

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
        let result = update_songs(req).await?;

        let message = format!("Updated {} song(s)", result.songs_updated);
        Ok(CommandOutput::new(message, result))
    } else {
        unreachable!("handle_update_songs called with wrong action variant")
    }
}
