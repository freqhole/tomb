//! atlas page builder for the graph view.
//!
//! given a list of *original* media_blob ids, resolves each to its
//! pre-generated thumbnail at the requested edge size, decodes the bytes,
//! and composites them into a single packed webp "atlas page" with a
//! manifest mapping each parent blob id to its sub-rect (u, v, w, h).
//!
//! the canvas2d path uses the manifest with `drawImage(atlas, sx, sy, sw,
//! sh, dx, dy, dw, dh)` to skip per-blob fetches; the upcoming webgl
//! path will upload the page once via `texImage2D` and sample sub-rects
//! per-instance.
//!
//! see `docs/graph-webgl-migration.md` for the larger plan and wire format
//! discussion. this module owns step 1-4 + 6 of the implementation order.

use crate::blob_data::get_blob_data;
use crate::database;
use crate::error::{GrimoireError, GrimoireResult};
use image::{imageops, DynamicImage, GenericImageView, ImageOutputFormat, RgbaImage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Cursor;
use zod_gen_derive::ZodSchema;

/// max thumbs per atlas page. keeps response size predictable and forces
/// the client to chunk large requests deterministically.
pub const MAX_IDS_PER_ATLAS: usize = 256;

/// hard cap on the resulting page edge. matches the safe minimum gpu max
/// texture size across the platforms we care about (most tier-2 mobile
/// gpus + wkwebview report at least 2048 here).
pub const MAX_PAGE_DIM: u32 = 2048;

/// request body for `POST /api/blobs/atlas`.
///
/// `ids` are *original* media_blob ids (the same ids returned in album
/// summaries as `remote_blob_id` / referenced by `album_imagez`). the
/// server resolves each to its pre-generated thumbnail at `size`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct BuildAtlasRequest {
    pub ids: Vec<String>,
    /// thumbnail edge size to look up per id (currently 50 or 200).
    pub size: u32,
    /// requested output format. only `"webp"` is supported today; the
    /// field is reserved so future formats can ship without a breaking
    /// wire change.
    #[serde(default)]
    pub format: Option<String>,
}

/// sub-rect of a single thumbnail within the packed atlas page, in pixels.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AtlasEntry {
    pub u: u32,
    pub v: u32,
    pub w: u32,
    pub h: u32,
}

/// manifest portion of the atlas wire response (the JSON header).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AtlasManifest {
    pub page_w: u32,
    pub page_h: u32,
    pub format: String,
    /// parent_blob_id -> sub-rect.
    pub entries: HashMap<String, AtlasEntry>,
    /// ids the server could not resolve (no thumbnail at the requested
    /// size, blob deleted, decode failed, etc). callers should treat
    /// these as "skip drawing" or fall back to a per-blob fetch.
    pub missing: Vec<String>,
}

/// internal builder output. callers serialize this into the wire format
/// (`[u32 le manifest_len][manifest_len bytes JSON][image bytes...]`).
pub struct AtlasResponse {
    pub manifest: AtlasManifest,
    pub image_bytes: Vec<u8>,
}

/// build a single atlas page from a list of original blob ids.
///
/// the resulting page is a square grid `ceil(sqrt(n)) * size` on a side,
/// padded with transparent pixels if `n` isn't a perfect square. each
/// resolved id occupies one grid cell; cells fill in the same order as
/// the request, so layout is reproducible across runs given the same
/// input.
///
/// ids the server can't resolve are reported in `manifest.missing` and
/// occupy no cell — they don't shift the layout of the resolved ones.
pub async fn build_atlas_response(req: BuildAtlasRequest) -> GrimoireResult<AtlasResponse> {
    let format = req.format.as_deref().unwrap_or("webp");
    if format != "webp" {
        return Err(GrimoireError::ProcessingFailed {
            message: format!("unsupported atlas format: {format}"),
        });
    }
    if req.ids.is_empty() {
        return Err(GrimoireError::ProcessingFailed {
            message: "atlas request with no ids".into(),
        });
    }
    if req.ids.len() > MAX_IDS_PER_ATLAS {
        return Err(GrimoireError::ProcessingFailed {
            message: format!(
                "atlas request exceeds max ids per page (got {}, max {})",
                req.ids.len(),
                MAX_IDS_PER_ATLAS
            ),
        });
    }

    let size = req.size;
    if size == 0 || size > 512 {
        return Err(GrimoireError::ProcessingFailed {
            message: format!("invalid atlas thumb size: {size}"),
        });
    }

    // resolve parent_blob_id -> thumb_id for the requested size in one
    // query. json_each is the standard sqlite trick for variable-length
    // IN-lists; matches the pattern in `find_present_sha256s`.
    let pool = database::connect().await?;
    let ids_json = serde_json::to_string(&req.ids).unwrap_or_else(|_| "[]".to_string());
    let width_i64 = size as i64;
    let thumb_rows = sqlx::query!(
        r#"SELECT parent_blob_id as "parent_blob_id!", id as "thumb_id!"
           FROM media_blobz
           WHERE blob_type = 'thumbnail'
             AND deleted_at IS NULL
             AND width = ?
             AND parent_blob_id IN (SELECT value FROM json_each(?))"#,
        width_i64,
        ids_json,
    )
    .fetch_all(&pool)
    .await?;

    // parent_id -> thumb_id; keep first hit if duplicates somehow exist.
    let mut parent_to_thumb: HashMap<String, String> = HashMap::with_capacity(thumb_rows.len());
    for row in thumb_rows {
        parent_to_thumb
            .entry(row.parent_blob_id)
            .or_insert(row.thumb_id);
    }

    // grid layout: tightest square that fits all *resolved* thumbs. note
    // we use parent_to_thumb.len() here (not req.ids.len()) so the page
    // doesn't grow to accommodate ids we can't satisfy.
    let resolved_count = parent_to_thumb.len().max(1);
    let cells_per_row = (resolved_count as f64).sqrt().ceil() as u32;
    let page_dim = cells_per_row * size;
    if page_dim > MAX_PAGE_DIM {
        return Err(GrimoireError::ProcessingFailed {
            message: format!(
                "atlas page would exceed max dim {} (would be {})",
                MAX_PAGE_DIM, page_dim
            ),
        });
    }

    // canvas starts transparent; thumbs we fail to decode just leave a hole
    // and are reported in `missing` instead.
    let mut canvas: RgbaImage = RgbaImage::new(page_dim, page_dim);

    let mut entries: HashMap<String, AtlasEntry> = HashMap::with_capacity(resolved_count);
    let mut missing: Vec<String> = Vec::new();

    // iterate the original request order so the missing/present lists and
    // the visual layout are stable across runs (helpful for debugging).
    let mut cell_index: u32 = 0;
    for parent_id in &req.ids {
        let Some(thumb_id) = parent_to_thumb.get(parent_id) else {
            missing.push(parent_id.clone());
            continue;
        };
        let data_resp = get_blob_data(thumb_id).await;
        let Some(bytes) = data_resp.data else {
            missing.push(parent_id.clone());
            continue;
        };
        let img = match image::load_from_memory(&bytes) {
            Ok(i) => i,
            Err(_) => {
                missing.push(parent_id.clone());
                continue;
            }
        };

        // thumbs should already be square at `size` x `size`; force-resize
        // defensively in case a stored thumb mismatches its row metadata.
        let (iw, ih) = img.dimensions();
        let rgba = if iw == size && ih == size {
            img.to_rgba8()
        } else {
            img.resize_exact(size, size, imageops::FilterType::Triangle)
                .to_rgba8()
        };

        let col = cell_index % cells_per_row;
        let row = cell_index / cells_per_row;
        let u = col * size;
        let v = row * size;
        imageops::overlay(
            &mut canvas,
            &DynamicImage::ImageRgba8(rgba),
            u as i64,
            v as i64,
        );

        entries.insert(
            parent_id.clone(),
            AtlasEntry {
                u,
                v,
                w: size,
                h: size,
            },
        );
        cell_index += 1;
    }

    // encode the packed page as webp. matches the format used for the
    // individual thumbnails, so client decode cost is uniform.
    let canvas_dyn = DynamicImage::ImageRgba8(canvas);
    let mut image_bytes = Vec::new();
    canvas_dyn
        .write_to(&mut Cursor::new(&mut image_bytes), ImageOutputFormat::WebP)
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to encode atlas webp: {e}"),
        })?;

    let manifest = AtlasManifest {
        page_w: page_dim,
        page_h: page_dim,
        format: "webp".to_string(),
        entries,
        missing,
    };

    Ok(AtlasResponse {
        manifest,
        image_bytes,
    })
}
