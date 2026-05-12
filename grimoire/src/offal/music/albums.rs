//! album API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::config::get_config;
use crate::error::ErrorDetail;
use crate::media_blobz::{
    create_media_blob, get_media_blob_by_sha256, BlobType, CreateMediaBlobRequest,
};
use crate::music::crud::{query_albums, DeleteAlbumRequest, GetAlbumRequest, QueryParams};
use crate::music::entities::albums::add_album_image;
use crate::music::entities::albums::external_url_proposals::{
    apply_external_urls as grimoire_apply_external_urls,
    propose_external_urls as grimoire_propose_external_urls, ApplyExternalUrlsRequest,
    ProposeExternalUrlsRequest,
};
use crate::music::entities::albums::metadata::{
    AutoConfirmMbMatchesRequest, ConfirmMbMatchRequest, MbMatchActionResponse, RejectMbMatchRequest,
};
use crate::music::entities::albums::taxon_proposals::{
    apply_taxon_proposals as grimoire_apply_taxon_proposals,
    propose_taxons_for_album as grimoire_propose_taxons_for_album, ApplyTaxonProposalsRequest,
    ProposeTaxonsRequest,
};
use crate::music::entities::albums::{
    auto_confirm_mb_matches as grimoire_auto_confirm_mb_matches,
    confirm_mb_match as grimoire_confirm_mb_match, delete_album as grimoire_delete_album,
    get_album as grimoire_get_album, get_album_images as grimoire_get_album_images,
    reject_mb_match as grimoire_reject_mb_match, remove_album_image,
    set_album_review_status as grimoire_set_album_review_status, set_primary_album_image,
    update_album as grimoire_update_album, SetAlbumReviewStatusRequest, UpdateAlbumRequest,
};
use crate::music::entities::artists::{
    add_artist_image, remove_artist_image, set_primary_artist_image,
};
use crate::music::entities::playlists::{remove_playlist_image, set_primary_playlist_image};
use crate::music::entities::songs::{remove_song_image, set_primary_song_image};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::upload::{DeleteImageRequest, SetPrimaryImageRequest};
use crate::users::UserRole;
use serde_json::Value as JsonValue;

/// route metadata for albums
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "query_albums",
        path: "/api/albums/query",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryParams",
        response_type: "AlbumsQueryResult",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_album",
        path: "/api/albums/get",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetAlbumRequest",
        response_type: "Album",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "delete_album",
        path: "/api/albums/delete",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "DeleteAlbumRequest",
        response_type: "DeleteAlbumResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "update_album",
        path: "/api/albums/update",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UpdateAlbumRequest",
        response_type: "Album",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "get_album_images",
        path: "/api/albums/images",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetAlbumRequest",
        response_type: "Vec<String>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "confirm_mb_match",
        path: "/api/albums/mb-confirm",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ConfirmMbMatchRequest",
        response_type: "MbMatchActionResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "reject_mb_match",
        path: "/api/albums/mb-reject",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "RejectMbMatchRequest",
        response_type: "MbMatchActionResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "auto_confirm_mb_matches",
        path: "/api/albums/mb-auto-confirm",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "AutoConfirmMbMatchesRequest",
        response_type: "AutoConfirmMbMatchesResult",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "propose_taxons",
        path: "/api/albums/propose-taxons",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ProposeTaxonsRequest",
        response_type: "Vec<TaxonProposal>",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "apply_taxon_proposals",
        path: "/api/albums/apply-taxon-proposals",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ApplyTaxonProposalsRequest",
        response_type: "ApplyTaxonProposalsResult",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "set_album_review_status",
        path: "/api/albums/set-review-status",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SetAlbumReviewStatusRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "propose_external_urls",
        path: "/api/albums/propose-external-urls",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ProposeExternalUrlsRequest",
        response_type: "ProposeExternalUrlsResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "apply_external_urls",
        path: "/api/albums/apply-external-urls",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ApplyExternalUrlsRequest",
        response_type: "ApplyExternalUrlsResult",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "ingest_remote_image",
        path: "/api/music/images/ingest",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "IngestRemoteImageRequest",
        response_type: "IngestRemoteImageResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "image_candidates_for_album",
        path: "/api/music/albums/image-candidates",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "AlbumImageCandidatesRequest",
        response_type: "AlbumImageCandidatesResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
];

/// query albums
///
/// path: POST /api/albums/query
pub async fn query(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let mut params: QueryParams = match serde_json::from_value(body) {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let target_user_id = match &params.user_id {
        Some(uid) if uid != &caller.user_id => {
            if !caller.is_admin() {
                return GrimoireResponse::failure(
                    "forbidden",
                    vec![ErrorDetail::new(
                        "forbidden",
                        "forbidden",
                        "cannot query another user's data",
                    )],
                );
            }
            uid.clone()
        }
        Some(uid) => uid.clone(),
        None => caller.user_id.clone(),
    };

    params.user_id = Some(target_user_id);

    let response = query_albums(params).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get album by id
///
/// path: POST /api/albums/get
pub async fn get(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetAlbumRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = grimoire_get_album(&req.id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get album images
///
/// path: POST /api/albums/images
pub async fn get_images(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetAlbumRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = grimoire_get_album_images(&req.id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// update album
///
/// path: POST /api/albums/update
pub async fn update(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let mut req: UpdateAlbumRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    // inject authenticated user id
    req.updated_by = Some(caller.user_id.clone());

    let response = grimoire_update_album(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// delete album
///
/// path: POST /api/albums/delete
pub async fn delete(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: DeleteAlbumRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = grimoire_delete_album(&req.id, Some(caller.user_id.clone())).await;
    response.map(|_| JsonValue::Null)
}

/// delete image
///
/// path: POST /api/music/images/delete
pub async fn delete_image(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: DeleteImageRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    // dispatch to the correct entity's remove image function
    let response = match req.entity_type.as_str() {
        "song" => remove_song_image(&req.entity_id, &req.blob_id).await,
        "album" => remove_album_image(&req.entity_id, &req.blob_id).await,
        "artist" => remove_artist_image(&req.entity_id, &req.blob_id).await,
        "playlist" => remove_playlist_image(&req.entity_id, &req.blob_id).await,
        _ => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "unsupported entity type",
                    &format!("entity_type '{}' not supported", req.entity_type),
                )],
            )
        }
    };
    response.map(|_| JsonValue::Null)
}

/// set primary image
///
/// path: POST /api/music/images/set-primary
pub async fn set_primary_image(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: SetPrimaryImageRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    // dispatch to the correct entity's set primary image function
    let response = match req.entity_type.as_str() {
        "song" => set_primary_song_image(&req.entity_id, &req.blob_id).await,
        "album" => set_primary_album_image(&req.entity_id, &req.blob_id).await,
        "artist" => set_primary_artist_image(&req.entity_id, &req.blob_id).await,
        "playlist" => set_primary_playlist_image(&req.entity_id, &req.blob_id).await,
        _ => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "unsupported entity type",
                    &format!("entity_type '{}' not supported", req.entity_type),
                )],
            )
        }
    };
    response.map(|_| JsonValue::Null)
}

/// confirm musicbrainz match
///
/// path: POST /api/albums/mb-confirm
pub async fn confirm_mb_match(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: ConfirmMbMatchRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = grimoire_confirm_mb_match(
        &req.album_id,
        &req.release_group_id,
        req.release_id.as_deref(),
        &caller.user_id,
    )
    .await;

    let album_id = req.album_id.clone();
    response.map(|_meta| {
        serde_json::to_value(MbMatchActionResponse {
            album_id,
            status: crate::music::entities::albums::metadata::MbLookupStatus::Confirmed,
        })
        .unwrap()
    })
}

/// reject musicbrainz match
///
/// path: POST /api/albums/mb-reject
pub async fn reject_mb_match(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: RejectMbMatchRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = grimoire_reject_mb_match(&req.album_id, &caller.user_id).await;

    let album_id = req.album_id.clone();
    response.map(|_meta| {
        serde_json::to_value(MbMatchActionResponse {
            album_id,
            status: crate::music::entities::albums::metadata::MbLookupStatus::Rejected,
        })
        .unwrap()
    })
}

/// auto-confirm musicbrainz matches in bulk
///
/// path: POST /api/albums/mb-auto-confirm
pub async fn auto_confirm_mb_matches(
    caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: AutoConfirmMbMatchesRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = grimoire_auto_confirm_mb_matches(
        &req.album_ids,
        req.min_confidence,
        req.min_gap,
        &caller.user_id,
    )
    .await;

    response.map(|data| serde_json::to_value(data).unwrap())
}

/// list proposed taxons for an album (phase 14.2)
///
/// reads the album's enrichment metadata blob and returns proposed
/// `(kind, label)` links the user can accept/edit/drop in the review ui.
/// purely read-only — no writes to `album_taxonz`.
///
/// path: POST /api/albums/propose-taxons
pub async fn propose_taxons(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }
    let req: ProposeTaxonsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };
    let response = grimoire_propose_taxons_for_album(&req.album_id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// commit the user's accepted taxon proposals (phase 14.3)
///
/// path: POST /api/albums/apply-taxon-proposals
pub async fn apply_taxon_proposals(
    caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }
    let req: ApplyTaxonProposalsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };
    let response = grimoire_apply_taxon_proposals(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// flip an album's `review_status` (phase 11). called by the bulk
/// enrichment review wizard on save+next (`complete`) and dismiss
/// (`dismissed`).
///
/// path: POST /api/albums/set-review-status
pub async fn set_album_review_status(
    caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }
    let req: SetAlbumReviewStatusRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };
    let response = grimoire_set_album_review_status(req).await;
    response.map(|_| serde_json::Value::Null)
}

// =============================================================================
// remote image ingestion (phase 14.6)
// =============================================================================

/// where to attach the ingested image. matches the discriminator on the
/// generated typescript zod schema (`{ kind: "Album", id }` or
/// `{ kind: "Artist", id }`). NOTE: PascalCase variant names — the zod
/// codegen doesn't honor `rename_all`, so we must not set it here or
/// serde + zod will disagree.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, zod_gen_derive::ZodSchema)]
#[serde(tag = "kind", content = "id")]
pub enum ImageIngestTarget {
    Album(String),
    Artist(String),
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, zod_gen_derive::ZodSchema)]
pub struct IngestRemoteImageRequest {
    pub remote_url: String,
    pub target: ImageIngestTarget,
    #[serde(default)]
    pub is_primary: bool,
    /// optional human-friendly source label for the blob's metadata json
    /// (e.g. "lastfm", "audiodb"). purely descriptive.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, zod_gen_derive::ZodSchema)]
pub struct IngestRemoteImageResponse {
    pub blob_id: String,
    pub sha256: String,
    pub size: i64,
    pub mime: String,
    /// true when the same sha256 was already in `media_blobz` and we
    /// skipped the disk write + insert (just re-linked).
    pub deduped: bool,
}

/// max bytes accepted from a remote image url. avoids accidentally pulling
/// down arbitrarily large assets.
const MAX_REMOTE_IMAGE_BYTES: usize = 16 * 1024 * 1024; // 16MB

/// download an image from a remote url and link it to an album or artist.
/// dedups on sha256: if we already have the blob, no fetch + no disk write,
/// just the link row.
///
/// path: POST /api/music/images/ingest
pub async fn ingest_remote_image(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }
    let req: IngestRemoteImageRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    // require https/http only — guards against `file://`, `data:`, etc.
    let scheme_ok = req.remote_url.starts_with("https://") || req.remote_url.starts_with("http://");
    if !scheme_ok {
        return GrimoireResponse::failure(
            "bad request",
            vec![ErrorDetail::new(
                "bad_request",
                "bad request",
                "remote_url must be http or https",
            )],
        );
    }

    // GET the bytes. set a sane timeout + size cap.
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(concat!("freqhole/", env!("CARGO_PKG_VERSION")))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return GrimoireResponse::failure(
                "http client unavailable",
                vec![ErrorDetail::new(
                    "internal_error",
                    "http client unavailable",
                    &e.to_string(),
                )],
            )
        }
    };

    let resp = match client.get(&req.remote_url).send().await {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "remote fetch failed",
                vec![ErrorDetail::new(
                    "remote_fetch_failed",
                    "remote fetch failed",
                    &e.to_string(),
                )],
            )
        }
    };
    if !resp.status().is_success() {
        return GrimoireResponse::failure(
            "remote returned non-2xx",
            vec![ErrorDetail::new(
                "remote_fetch_failed",
                "remote returned non-2xx",
                &format!("status {}", resp.status()),
            )],
        );
    }
    let mime_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or(s).trim().to_string())
        .unwrap_or_else(|| "image/jpeg".to_string());
    if !mime_type.starts_with("image/") {
        return GrimoireResponse::failure(
            "bad request",
            vec![ErrorDetail::new(
                "bad_request",
                "bad request",
                &format!("remote content-type is not an image: {}", mime_type),
            )],
        );
    }
    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => {
            return GrimoireResponse::failure(
                "remote fetch failed",
                vec![ErrorDetail::new(
                    "remote_fetch_failed",
                    "remote fetch failed",
                    &e.to_string(),
                )],
            )
        }
    };
    if bytes.len() > MAX_REMOTE_IMAGE_BYTES {
        return GrimoireResponse::failure(
            "image too large",
            vec![ErrorDetail::new(
                "bad_request",
                "image too large",
                &format!(
                    "remote image is {} bytes (max {})",
                    bytes.len(),
                    MAX_REMOTE_IMAGE_BYTES
                ),
            )],
        );
    }
    let size = bytes.len() as i64;

    // sha256 dedup check first: if we already have it, just link.
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let sha256_hex = format!("{:x}", hasher.finalize());

    let (blob_id, deduped, mime_out) = match get_media_blob_by_sha256(&sha256_hex).await {
        Ok(existing) => (
            existing.id,
            true,
            existing.mime.unwrap_or_else(|| mime_type.clone()),
        ),
        Err(_) => {
            // new blob: write to disk under data/fetch/YYYY/MM/<id>.<ext>
            let blake3_hash = crate::blobz::compute_blake3_from_bytes(&bytes);
            let ext = match mime_type.as_str() {
                "image/png" => "png",
                "image/webp" => "webp",
                "image/gif" => "gif",
                "image/avif" => "avif",
                "image/svg+xml" => "svg",
                _ => "jpg",
            };
            let blob = match create_media_blob(CreateMediaBlobRequest {
                sha256: sha256_hex.clone(),
                size: Some(size),
                mime: Some(mime_type.clone()),
                source_client_id: None,
                local_path: None,
                filename: None,
                parent_blob_id: None,
                blob_type: Some(BlobType::Original),
                metadata: serde_json::json!({
                    "remote_url": req.remote_url,
                    "source": req.source.clone().unwrap_or_default(),
                }),
                created_by: Some(caller.user_id.clone()),
                data: None,
                width: None,
                height: None,
                blake3: Some(blake3_hash),
            })
            .await
            {
                Ok(b) => b,
                Err(e) => {
                    return GrimoireResponse::failure(
                        "failed to create blob",
                        vec![ErrorDetail::from(e)],
                    )
                }
            };

            // write to disk under fetch/YYYY/MM/<id>.<ext>
            let cfg = get_config();
            let output_dir = cfg
                .server
                .as_ref()
                .and_then(|s| s.fetch_music.as_ref())
                .and_then(|f| f.output_dir.as_ref())
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| cfg.data_dir.join("fetch"));
            let now = time::OffsetDateTime::now_utc();
            let rel_path = format!(
                "{:04}/{:02}/{}.{}",
                now.year(),
                now.month() as u8,
                blob.id,
                ext
            );
            let full_path = output_dir.join(&rel_path);
            if let Some(parent) = full_path.parent() {
                if let Err(e) = tokio::fs::create_dir_all(parent).await {
                    return GrimoireResponse::failure(
                        "failed to create directory",
                        vec![ErrorDetail::new(
                            "internal_error",
                            "failed to create directory",
                            &e.to_string(),
                        )],
                    );
                }
            }
            if let Err(e) = tokio::fs::write(&full_path, &bytes).await {
                return GrimoireResponse::failure(
                    "failed to write file",
                    vec![ErrorDetail::new(
                        "internal_error",
                        "failed to write file",
                        &e.to_string(),
                    )],
                );
            }
            // record local_path on the blob row
            let _ = crate::media_blobz::update_blob_local_path(
                &blob.id,
                full_path.to_string_lossy().as_ref(),
                Some(caller.user_id.clone()),
            )
            .await;

            (blob.id, false, mime_type.clone())
        }
    };

    // link to album or artist
    let link_resp = match &req.target {
        ImageIngestTarget::Album(album_id) => {
            add_album_image(
                album_id,
                &blob_id,
                req.is_primary,
                Some((&caller.user_id, &caller.username)),
            )
            .await
        }
        ImageIngestTarget::Artist(artist_id) => {
            add_artist_image(
                artist_id,
                &blob_id,
                req.is_primary,
                Some((&caller.user_id, &caller.username)),
            )
            .await
        }
    };
    if !link_resp.success {
        return GrimoireResponse::failure(&link_resp.message, link_resp.errors);
    }

    let body = IngestRemoteImageResponse {
        blob_id,
        sha256: sha256_hex,
        size,
        mime: mime_out,
        deduped,
    };
    GrimoireResponse::success("image ingested", serde_json::to_value(body).unwrap())
}

// =============================================================================
// album image candidates (slice 3)
// =============================================================================

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, zod_gen_derive::ZodSchema)]
pub struct AlbumImageCandidatesRequest {
    pub album_id: String,
}

/// one image candidate surfaced for review. `url` is the remote
/// fetchable url; `kind` is a freeform descriptor ("front", "back",
/// "cdart", "thumb_hq", etc) and `source` is the data source
/// ("audiodb" | "musicbrainz"). dimensions / size are best-effort
/// (not all sources expose them and we don't fetch HEAD here).
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, zod_gen_derive::ZodSchema)]
pub struct AlbumImageCandidate {
    pub url: String,
    pub source: String,
    pub kind: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, zod_gen_derive::ZodSchema)]
pub struct AlbumImageCandidatesResponse {
    pub album_id: String,
    pub candidates: Vec<AlbumImageCandidate>,
    /// blob ids of images currently linked to the album. lets the ui
    /// show "N already in library" without making the dedup decision
    /// itself — the actual dedup happens at ingest time via sha256.
    pub ingested_blob_ids: Vec<String>,
}

/// surface remote image candidates for an album from already-stored
/// metadata snapshots. read-only — never makes external http calls.
///
/// sources currently mined:
/// * `audiodb` — `album_thumb_hq`, `album_thumb`, `album_thumb_back`,
///   `album_cdart`, `album_spine`, `album_3d_case`
/// * `musicbrainz` — when `mb.release_id` is confirmed, emit canonical
///   `coverartarchive.org/release/{id}/front` + `/back` urls (we don't
///   pre-validate; ingest will fail soft if CAA returns 404)
///
/// path: POST /api/music/albums/image-candidates
pub async fn image_candidates_for_album(
    caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }
    let req: AlbumImageCandidatesRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    // pull album metadata snapshot.
    let meta_resp = crate::music::entities::albums::read_album_metadata(&req.album_id).await;
    if !meta_resp.success {
        return GrimoireResponse::failure(&meta_resp.message, meta_resp.errors);
    }
    let meta = meta_resp.data.unwrap_or_default();

    let mut candidates: Vec<AlbumImageCandidate> = Vec::new();

    // audiodb album thumbs.
    if let Some(ad) = meta.audiodb.as_ref() {
        if let Some(album) = ad.album.as_ref() {
            // (kind label, url) pairs. kept in priority order so the
            // ui renders the highest-quality variants first.
            let pairs: [(&str, Option<&String>); 6] = [
                ("thumb_hq", album.album_thumb_hq.as_ref()),
                ("thumb", album.album_thumb.as_ref()),
                ("back", album.album_thumb_back.as_ref()),
                ("cdart", album.album_cdart.as_ref()),
                ("spine", album.album_spine.as_ref()),
                ("3d_case", album.album_3d_case.as_ref()),
            ];
            for (kind, url) in pairs {
                if let Some(u) = url {
                    let trimmed = u.trim();
                    if !trimmed.is_empty()
                        && (trimmed.starts_with("http://") || trimmed.starts_with("https://"))
                    {
                        candidates.push(AlbumImageCandidate {
                            url: trimmed.to_string(),
                            source: "audiodb".to_string(),
                            kind: kind.to_string(),
                        });
                    }
                }
            }
        }
    }

    // musicbrainz cover art archive — derived urls only, no live http.
    if let Some(mb) = meta.musicbrainz.as_ref() {
        if let Some(rid) = mb.release_id.as_ref() {
            let r = rid.trim();
            if !r.is_empty() {
                candidates.push(AlbumImageCandidate {
                    url: format!("https://coverartarchive.org/release/{}/front", r),
                    source: "musicbrainz".to_string(),
                    kind: "front".to_string(),
                });
                candidates.push(AlbumImageCandidate {
                    url: format!("https://coverartarchive.org/release/{}/back", r),
                    source: "musicbrainz".to_string(),
                    kind: "back".to_string(),
                });
            }
        }
    }

    // currently-linked blob ids (so the ui can show "already in
    // library: N"). actual content-level dedup happens at ingest via
    // sha256, so the ui doesn't need a url<->blob map here.
    let imgs_resp = grimoire_get_album_images(&req.album_id).await;
    let ingested = if imgs_resp.success {
        imgs_resp.data.unwrap_or_default()
    } else {
        Vec::new()
    };

    let resp = AlbumImageCandidatesResponse {
        album_id: req.album_id,
        candidates,
        ingested_blob_ids: ingested,
    };
    GrimoireResponse::success(
        "album image candidates",
        serde_json::to_value(resp).unwrap(),
    )
}

/// surface external-url proposals for an album + its primary artist
/// from already-stored metadata snapshots (phase 11.x).
///
/// path: POST /api/albums/propose-external-urls
pub async fn propose_external_urls(
    caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }
    let req: ProposeExternalUrlsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };
    let response = grimoire_propose_external_urls(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// insert accepted external-url proposals into `entity_urlz`
/// (phase 11.x).
///
/// path: POST /api/albums/apply-external-urls
pub async fn apply_external_urls(
    caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }
    let req: ApplyExternalUrlsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };
    let created_by = Some(caller.user_id.as_str());
    let response = grimoire_apply_external_urls(req, created_by).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}
