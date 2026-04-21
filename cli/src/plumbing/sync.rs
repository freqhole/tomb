//! sync CLI commands - manual e2e testing helpers for the
//! send-to-remote pipeline. mirrors the offal /api/sync/* routes.

use crate::plumbing::dispatch::dispatch_to_offal;
use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use serde_json::Value as JsonValue;

#[derive(Subcommand)]
pub enum SyncAction {
    /// Send an album shell (metadata + cover images) to the local grimoire.
    /// Mirrors `POST /api/sync/album`.
    ///
    /// JSON body shape: `SyncAlbumRequest` (see grimoire/src/offal/sync/mod.rs).
    /// minimal example:
    ///   freqhole sync album --json '{
    ///     "remote_album_id": "abc",
    ///     "title": "My Album",
    ///     "artist_name": "Some Artist",
    ///     "remote_name": "test-remote"
    ///   }'
    Album {
        /// json body (string) matching the SyncAlbumRequest schema
        #[arg(long, value_name = "JSON")]
        json: String,
    },
}

/// handle sync commands
pub async fn handle_command(action: SyncAction) -> CommandOutput<JsonValue> {
    match action {
        SyncAction::Album { json } => {
            let body: JsonValue = match serde_json::from_str(&json) {
                Ok(v) => v,
                Err(e) => {
                    return CommandOutput::failure(
                        format!("invalid --json payload: {}", e),
                        vec![],
                        (),
                    )
                }
            };
            dispatch_to_offal("/api/sync/album", body).await
        }
    }
}
