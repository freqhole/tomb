//! generic mixed-kind playlist item CLI commands
//!
//! these routes are domain-neutral (`entity_type` is a plain string field,
//! not video-specific) - they live under the video command group for now
//! since video is the first domain to need mixed-kind playlists, but
//! photos/ebooks/etc can reuse the exact same routes later.

use crate::plumbing::dispatch::dispatch_to_offal;
use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use serde_json::json;

#[derive(Subcommand)]
pub enum PlaylistItemsAction {
    /// list items in a mixed-kind playlist
    List {
        #[arg(long)]
        playlist_id: String,
    },
    /// add items to a mixed-kind playlist (all items share one entity type)
    Add {
        #[arg(long)]
        playlist_id: String,
        #[arg(long)]
        entity_type: String,
        /// entity ids to add (comma-separated)
        #[arg(long, value_delimiter = ',')]
        entity_ids: Vec<String>,
    },
    /// remove items from a mixed-kind playlist (all items share one entity type)
    Remove {
        #[arg(long)]
        playlist_id: String,
        #[arg(long)]
        entity_type: String,
        /// entity ids to remove (comma-separated)
        #[arg(long, value_delimiter = ',')]
        entity_ids: Vec<String>,
    },
    /// reorder items in a mixed-kind playlist (all items share one entity type)
    Reorder {
        #[arg(long)]
        playlist_id: String,
        #[arg(long)]
        entity_type: String,
        /// entity ids in new order (comma-separated)
        #[arg(long, value_delimiter = ',')]
        entity_ids: Vec<String>,
    },
}

pub async fn handle_command(action: PlaylistItemsAction) -> CommandOutput<serde_json::Value> {
    match action {
        PlaylistItemsAction::List { playlist_id } => {
            dispatch_to_offal(
                "/api/playlists/items/list",
                json!({ "playlist_id": playlist_id }),
            )
            .await
        }
        PlaylistItemsAction::Add {
            playlist_id,
            entity_type,
            entity_ids,
        } => {
            let items: Vec<_> = entity_ids
                .into_iter()
                .map(|entity_id| json!({ "entity_type": entity_type, "entity_id": entity_id }))
                .collect();
            dispatch_to_offal(
                "/api/playlists/items/add",
                json!({ "playlist_id": playlist_id, "items": items }),
            )
            .await
        }
        PlaylistItemsAction::Remove {
            playlist_id,
            entity_type,
            entity_ids,
        } => {
            let items: Vec<_> = entity_ids
                .into_iter()
                .map(|entity_id| json!({ "entity_type": entity_type, "entity_id": entity_id }))
                .collect();
            dispatch_to_offal(
                "/api/playlists/items/remove",
                json!({ "playlist_id": playlist_id, "items": items }),
            )
            .await
        }
        PlaylistItemsAction::Reorder {
            playlist_id,
            entity_type,
            entity_ids,
        } => {
            let ordered_entity_refs: Vec<_> = entity_ids
                .into_iter()
                .map(|entity_id| json!({ "entity_type": entity_type, "entity_id": entity_id }))
                .collect();
            dispatch_to_offal(
                "/api/playlists/items/reorder",
                json!({ "playlist_id": playlist_id, "ordered_entity_refs": ordered_entity_refs }),
            )
            .await
        }
    }
}
