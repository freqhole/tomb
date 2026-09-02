//! generic entity <-> taxon link CLI commands
//!
//! these routes are domain-neutral (`entity_type` is a plain string field,
//! not video-specific) - they live under the video command group for now
//! since video is the first domain to need them, but photos/ebooks/etc can
//! reuse the exact same routes later.

use crate::plumbing::dispatch::dispatch_to_offal;
use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use serde_json::json;

#[derive(Subcommand)]
pub enum TaxonLinksAction {
    /// list taxon links for an entity
    Get {
        #[arg(long)]
        entity_type: String,
        #[arg(long)]
        entity_id: String,
    },
    /// replace the full taxon link set for an entity
    Set {
        #[arg(long)]
        entity_type: String,
        #[arg(long)]
        entity_id: String,
        /// taxon ids to link (comma-separated)
        #[arg(long, value_delimiter = ',')]
        taxon_ids: Vec<String>,
    },
    /// add a single entity <-> taxon link
    Add {
        #[arg(long)]
        entity_type: String,
        #[arg(long)]
        entity_id: String,
        #[arg(long)]
        taxon_id: String,
        #[arg(long, default_value = "user")]
        origin: String,
        #[arg(long)]
        confidence: Option<f64>,
    },
    /// remove an entity <-> taxon link
    Remove {
        #[arg(long)]
        entity_type: String,
        #[arg(long)]
        entity_id: String,
        #[arg(long)]
        taxon_id: String,
    },
}

pub async fn handle_command(action: TaxonLinksAction) -> CommandOutput<serde_json::Value> {
    match action {
        TaxonLinksAction::Get {
            entity_type,
            entity_id,
        } => {
            dispatch_to_offal(
                "/api/entities/taxons/get",
                json!({ "entity_type": entity_type, "entity_id": entity_id }),
            )
            .await
        }
        TaxonLinksAction::Set {
            entity_type,
            entity_id,
            taxon_ids,
        } => {
            dispatch_to_offal(
                "/api/entities/taxons/set",
                json!({
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                    "taxon_ids": taxon_ids,
                }),
            )
            .await
        }
        TaxonLinksAction::Add {
            entity_type,
            entity_id,
            taxon_id,
            origin,
            confidence,
        } => {
            dispatch_to_offal(
                "/api/entities/taxons/add",
                json!({
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                    "taxon_id": taxon_id,
                    "origin": origin,
                    "confidence": confidence,
                }),
            )
            .await
        }
        TaxonLinksAction::Remove {
            entity_type,
            entity_id,
            taxon_id,
        } => {
            dispatch_to_offal(
                "/api/entities/taxons/remove",
                json!({
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                    "taxon_id": taxon_id,
                }),
            )
            .await
        }
    }
}
