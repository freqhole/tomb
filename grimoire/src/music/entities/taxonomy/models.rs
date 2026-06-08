//! taxonomy domain models.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// numeric vs categorical distinction for a taxon kind.
///
/// `Categorical` kinds have rows in `taxonz`; their values are picked
/// from that set. `ScalarF64` / `ScalarI64` kinds have no `taxonz`
/// rows; their per-album values live in `scalar_attributez`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ZodSchema)]
#[serde(rename_all = "snake_case")]
pub enum ScalarValueType {
    Categorical,
    ScalarF64,
    ScalarI64,
}

impl ScalarValueType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ScalarValueType::Categorical => "categorical",
            ScalarValueType::ScalarF64 => "scalar_f64",
            ScalarValueType::ScalarI64 => "scalar_int",
        }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Option<ScalarValueType> {
        match s {
            "categorical" => Some(ScalarValueType::Categorical),
            "scalar_f64" => Some(ScalarValueType::ScalarF64),
            "scalar_int" => Some(ScalarValueType::ScalarI64),
            _ => None,
        }
    }
}

/// a kind of taxon (genre, mood, instrument, era, key, location,
/// label, bpm, loudness_db, energy, ...). user-defined kinds are
/// allowed (`is_user_defined = true`).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct TaxonKind {
    pub id: String,
    pub slug: String,
    pub label: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub value_type: String,
    pub unit: Option<String>,
    pub display_order: i64,
    pub is_user_defined: bool,
    pub created_at: i64,
    /// distinct (non-deleted) album count having at least one taxon of
    /// this kind. populated by `list_taxon_kinds`; fresh-create paths
    /// (`find_or_create_taxon_kind`, `create_taxon_kind`) set 0 since
    /// no album_taxonz rows exist yet.
    pub album_count: i64,
}

/// a categorical taxon node (e.g. `(kind=genre, label="rock")`).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct Taxon {
    pub id: String,
    pub kind_id: String,
    pub kind_slug: String,
    pub slug: String,
    pub label: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub is_user_defined: bool,
    pub created_at: i64,
    pub created_by: Option<String>,
}

/// lightweight reference for embedding in album payloads.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct TaxonRef {
    pub id: String,
    pub kind_slug: String,
    pub label: String,
}

/// taxon plus aggregate stats (album count, song count, total duration).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct TaxonWithStats {
    pub id: String,
    pub kind_id: String,
    pub kind_slug: String,
    pub slug: String,
    pub label: String,
    pub created_at: i64,
    pub album_count: i64,
    pub song_count: i64,
    pub total_duration: i64,
}

/// taxon + immediate parent / child ids, for tree rendering.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct TaxonNode {
    pub taxon: Taxon,
    pub parent_ids: Vec<String>,
    pub child_ids: Vec<String>,
}

/// link from an album to a taxon, plus its provenance.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct AlbumTaxonLink {
    pub album_id: String,
    pub taxon_id: String,
    pub kind_slug: String,
    pub label: String,
    pub origin: String,
    pub confidence: Option<f64>,
    pub created_at: i64,
    pub created_by: Option<String>,
}

/// numeric per-album attribute (bpm, loudness, energy, ...).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct ScalarAttribute {
    pub album_id: String,
    pub taxon_kind_id: String,
    pub kind_slug: String,
    pub value_f64: f64,
    pub origin: String,
    pub confidence: Option<f64>,
    pub created_at: i64,
    pub created_by: Option<String>,
}

// ---- request types ----

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateTaxonKindRequest {
    pub slug: String,
    pub label: String,
    pub description: Option<String>,
    pub color: Option<String>,
    /// one of `categorical` / `scalar_f64` / `scalar_int`. defaults to
    /// `categorical` when omitted.
    pub value_type: Option<String>,
    pub unit: Option<String>,
    pub display_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateTaxonRequest {
    pub kind_slug: String,
    pub label: String,
    pub description: Option<String>,
    /// existing taxon ids to link as parents (DAG edges).
    pub parent_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetTaxonRequest {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct DeleteTaxonRequest {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct QueryTaxonsRequest {
    /// optional kind filter; when set, only taxons of this kind are returned.
    pub kind_slug: Option<String>,
    /// case-insensitive label substring search.
    pub q: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct TaxonsQueryResult {
    pub items: Vec<TaxonWithStats>,
    pub total_count: i64,
    pub has_more: bool,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AddTaxonParentRequest {
    pub child_id: String,
    pub parent_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RemoveTaxonParentRequest {
    pub child_id: String,
    pub parent_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AddAlbumTaxonRequest {
    pub album_id: String,
    pub taxon_id: String,
    pub origin: String,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RemoveAlbumTaxonRequest {
    pub album_id: String,
    pub taxon_id: String,
    /// when set, only the link from this origin is removed; otherwise
    /// every link for the (album, taxon) pair is removed.
    pub origin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SetAlbumTaxonsRequest {
    pub album_id: String,
    /// the full set of (taxon_id, origin, confidence) links the album
    /// should have. existing links not present in this list are removed.
    pub links: Vec<AlbumTaxonLinkInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AlbumTaxonLinkInput {
    pub taxon_id: String,
    pub origin: String,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SetScalarAttributeRequest {
    pub album_id: String,
    pub kind_slug: String,
    pub value_f64: f64,
    pub origin: String,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct QueryScalarRangeRequest {
    pub kind_slug: String,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListTaxonsByKindRequest {
    pub kind_slug: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetAlbumTaxonLinksRequest {
    pub album_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SetTaxonColorRequest {
    pub taxon_id: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SetTaxonLabelRequest {
    pub taxon_id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SetTaxonKindColorRequest {
    pub kind_slug: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SetTaxonKindLabelRequest {
    pub kind_slug: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListTaxonParentsForKindRequest {
    pub kind_slug: String,
}

/// a single parent edge in the taxon DAG (child -> parent).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct TaxonParentEdge {
    pub child_id: String,
    pub parent_id: String,
}
