//! taxonomy CLI commands (music domain) — uses offal dispatch
//!
//! exposes the cross-kind taxonomy: kinds (genre / mood / instrument / era /
//! key / location / label / bpm / loudness_db / energy / ...), taxons
//! (categorical nodes), the parent DAG, album<->taxon links, and per-album
//! scalar attributes.

use crate::plumbing::dispatch::dispatch_to_offal;
use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use serde_json::json;

#[derive(Subcommand)]
pub enum TaxonomyAction {
    // ---- kinds ----
    /// list all taxon kinds (genre, mood, instrument, ...)
    ListKinds,
    /// create a new taxon kind
    CreateKind {
        /// stable slug used in the api (e.g. `era`, `instrument`)
        #[arg(long)]
        slug: String,
        /// human label
        #[arg(long)]
        label: String,
        #[arg(long)]
        description: Option<String>,
        /// hex color for ui chips
        #[arg(long)]
        color: Option<String>,
        /// `categorical` (default), `scalar_f64`, or `scalar_int`
        #[arg(long)]
        value_type: Option<String>,
        /// unit string for scalar kinds (e.g. `bpm`, `dB`)
        #[arg(long)]
        unit: Option<String>,
        #[arg(long)]
        display_order: Option<i64>,
    },

    // ---- taxons ----
    /// list all taxons of a given kind
    ListTaxonsByKind {
        /// kind slug (e.g. `genre`, `mood`, `label`)
        #[arg(long)]
        kind_slug: String,
    },
    /// query taxons with optional kind filter and substring search
    QueryTaxons {
        #[arg(long)]
        kind_slug: Option<String>,
        /// case-insensitive label substring
        #[arg(long)]
        q: Option<String>,
        #[arg(long)]
        limit: Option<u32>,
        #[arg(long)]
        offset: Option<u32>,
    },
    /// fetch a single taxon by id
    GetTaxon {
        #[arg(long)]
        id: String,
    },
    /// create a new taxon under an existing kind
    CreateTaxon {
        #[arg(long)]
        kind_slug: String,
        #[arg(long)]
        label: String,
        #[arg(long)]
        description: Option<String>,
        /// existing taxon ids to link as parents (DAG edges, comma-separated)
        #[arg(long, value_delimiter = ',')]
        parent_ids: Option<Vec<String>>,
    },
    /// set (or clear) a taxon's color (hex string, e.g. `#9b5de5`)
    SetTaxonColor {
        #[arg(long)]
        taxon_id: String,
        /// hex color; omit to clear
        #[arg(long)]
        color: Option<String>,
    },
    /// soft-delete a taxon by id
    DeleteTaxon {
        #[arg(long)]
        id: String,
    },

    // ---- parents (DAG) ----
    /// add a parent edge (cycle-checked)
    AddParent {
        #[arg(long)]
        child_id: String,
        #[arg(long)]
        parent_id: String,
    },
    /// remove a parent edge
    RemoveParent {
        #[arg(long)]
        child_id: String,
        #[arg(long)]
        parent_id: String,
    },
    /// list every parent edge whose child has the given kind (full DAG dump)
    ListParentsForKind {
        #[arg(long)]
        kind_slug: String,
    },
    /// list ancestors of a taxon (transitive)
    Ancestors {
        #[arg(long)]
        id: String,
    },
    /// list descendants of a taxon (transitive)
    Descendants {
        #[arg(long)]
        id: String,
    },

    // ---- album links ----
    /// list all taxon links for an album
    GetAlbumLinks {
        #[arg(long)]
        album_id: String,
    },
    /// add a single album <-> taxon link
    AddAlbumLink {
        #[arg(long)]
        album_id: String,
        #[arg(long)]
        taxon_id: String,
        /// origin: `user`, `musicbrainz`, `lastfm`, `audiodb`, ...
        #[arg(long, default_value = "user")]
        origin: String,
        #[arg(long)]
        confidence: Option<f64>,
    },
    /// remove an album <-> taxon link (optionally only for one origin)
    RemoveAlbumLink {
        #[arg(long)]
        album_id: String,
        #[arg(long)]
        taxon_id: String,
        #[arg(long)]
        origin: Option<String>,
    },
    /// replace the full link set for an album with a json list of
    /// `[{taxon_id, origin, confidence?}, ...]`
    SetAlbumLinks {
        #[arg(long)]
        album_id: String,
        /// json array of links
        #[arg(long)]
        links_json: String,
    },

    // ---- scalar attributes ----
    /// set a per-album scalar value (bpm, energy, loudness_db, ...)
    SetScalar {
        #[arg(long)]
        album_id: String,
        #[arg(long)]
        kind_slug: String,
        #[arg(long)]
        value: f64,
        #[arg(long, default_value = "user")]
        origin: String,
        #[arg(long)]
        confidence: Option<f64>,
    },
    /// list album ids whose scalar value falls in [min, max]
    QueryScalarRange {
        #[arg(long)]
        kind_slug: String,
        #[arg(long)]
        min: Option<f64>,
        #[arg(long)]
        max: Option<f64>,
        #[arg(long)]
        limit: Option<u32>,
        #[arg(long)]
        offset: Option<u32>,
    },
}

pub async fn handle_command(action: TaxonomyAction) -> CommandOutput<serde_json::Value> {
    match action {
        TaxonomyAction::ListKinds => dispatch_to_offal("/api/taxonomy/kinds/list", json!({})).await,
        TaxonomyAction::CreateKind {
            slug,
            label,
            description,
            color,
            value_type,
            unit,
            display_order,
        } => {
            dispatch_to_offal(
                "/api/taxonomy/kinds/create",
                json!({
                    "slug": slug,
                    "label": label,
                    "description": description,
                    "color": color,
                    "value_type": value_type,
                    "unit": unit,
                    "display_order": display_order,
                }),
            )
            .await
        }

        TaxonomyAction::ListTaxonsByKind { kind_slug } => {
            dispatch_to_offal(
                "/api/taxonomy/taxons/list-by-kind",
                json!({ "kind_slug": kind_slug }),
            )
            .await
        }
        TaxonomyAction::QueryTaxons {
            kind_slug,
            q,
            limit,
            offset,
        } => {
            dispatch_to_offal(
                "/api/taxonomy/taxons/query",
                json!({
                    "kind_slug": kind_slug,
                    "q": q,
                    "limit": limit,
                    "offset": offset,
                }),
            )
            .await
        }
        TaxonomyAction::GetTaxon { id } => {
            dispatch_to_offal("/api/taxonomy/taxons/get", json!({ "id": id })).await
        }
        TaxonomyAction::CreateTaxon {
            kind_slug,
            label,
            description,
            parent_ids,
        } => {
            dispatch_to_offal(
                "/api/taxonomy/taxons/create",
                json!({
                    "kind_slug": kind_slug,
                    "label": label,
                    "description": description,
                    "parent_ids": parent_ids,
                }),
            )
            .await
        }
        TaxonomyAction::SetTaxonColor { taxon_id, color } => {
            dispatch_to_offal(
                "/api/taxonomy/taxons/set-color",
                json!({ "taxon_id": taxon_id, "color": color }),
            )
            .await
        }
        TaxonomyAction::DeleteTaxon { id } => {
            dispatch_to_offal("/api/taxonomy/taxons/delete", json!({ "id": id })).await
        }

        TaxonomyAction::AddParent {
            child_id,
            parent_id,
        } => {
            dispatch_to_offal(
                "/api/taxonomy/parents/add",
                json!({ "child_id": child_id, "parent_id": parent_id }),
            )
            .await
        }
        TaxonomyAction::RemoveParent {
            child_id,
            parent_id,
        } => {
            dispatch_to_offal(
                "/api/taxonomy/parents/remove",
                json!({ "child_id": child_id, "parent_id": parent_id }),
            )
            .await
        }
        TaxonomyAction::ListParentsForKind { kind_slug } => {
            dispatch_to_offal(
                "/api/taxonomy/parents/list-by-kind",
                json!({ "kind_slug": kind_slug }),
            )
            .await
        }
        TaxonomyAction::Ancestors { id } => {
            dispatch_to_offal("/api/taxonomy/taxons/ancestors", json!({ "id": id })).await
        }
        TaxonomyAction::Descendants { id } => {
            dispatch_to_offal("/api/taxonomy/taxons/descendants", json!({ "id": id })).await
        }

        TaxonomyAction::GetAlbumLinks { album_id } => {
            dispatch_to_offal(
                "/api/taxonomy/album-links/get",
                json!({ "album_id": album_id }),
            )
            .await
        }
        TaxonomyAction::AddAlbumLink {
            album_id,
            taxon_id,
            origin,
            confidence,
        } => {
            dispatch_to_offal(
                "/api/taxonomy/album-links/add",
                json!({
                    "album_id": album_id,
                    "taxon_id": taxon_id,
                    "origin": origin,
                    "confidence": confidence,
                }),
            )
            .await
        }
        TaxonomyAction::RemoveAlbumLink {
            album_id,
            taxon_id,
            origin,
        } => {
            dispatch_to_offal(
                "/api/taxonomy/album-links/remove",
                json!({
                    "album_id": album_id,
                    "taxon_id": taxon_id,
                    "origin": origin,
                }),
            )
            .await
        }
        TaxonomyAction::SetAlbumLinks {
            album_id,
            links_json,
        } => {
            let links: serde_json::Value = match serde_json::from_str(&links_json) {
                Ok(v) => v,
                Err(e) => {
                    return CommandOutput::failure(
                        format!("invalid --links-json: {}", e),
                        vec![],
                        serde_json::Value::Null,
                    );
                }
            };
            dispatch_to_offal(
                "/api/taxonomy/album-links/set",
                json!({ "album_id": album_id, "links": links }),
            )
            .await
        }

        TaxonomyAction::SetScalar {
            album_id,
            kind_slug,
            value,
            origin,
            confidence,
        } => {
            dispatch_to_offal(
                "/api/taxonomy/scalars/set",
                json!({
                    "album_id": album_id,
                    "kind_slug": kind_slug,
                    "value_f64": value,
                    "origin": origin,
                    "confidence": confidence,
                }),
            )
            .await
        }
        TaxonomyAction::QueryScalarRange {
            kind_slug,
            min,
            max,
            limit,
            offset,
        } => {
            dispatch_to_offal(
                "/api/taxonomy/scalars/query-range",
                json!({
                    "kind_slug": kind_slug,
                    "min": min,
                    "max": max,
                    "limit": limit,
                    "offset": offset,
                }),
            )
            .await
        }
    }
}
