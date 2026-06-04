//! artist API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::crud::{query_artists, DeleteArtistRequest, GetArtistRequest, QueryParams};
use crate::music::entities::artists::{
    apply_artist_bio as grimoire_apply_artist_bio,
    apply_related_artists as grimoire_apply_related_artists, create_artist,
    delete_artist as grimoire_delete_artist, get_artist as grimoire_get_artist,
    get_artist_images as grimoire_get_artist_images,
    propose_artist_bios as grimoire_propose_artist_bios,
    propose_related_artists as grimoire_propose_related_artists,
    update_artist as grimoire_update_artist,
    update_artist_metadata as grimoire_update_artist_metadata, ApplyArtistBioRequest,
    ApplyRelatedArtistsRequest, CreateArtistRequest, ProposeArtistBiosRequest,
    ProposeRelatedArtistsRequest, UpdateArtistMetadataRequest, UpdateArtistRequest,
};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use serde_json::Value as JsonValue;

/// route metadata for artists
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "create_artist",
        path: "/api/music/artists",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "CreateArtistRequest",
        response_type: "Artist",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "query_artists",
        path: "/api/artists/query",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryParams",
        response_type: "ArtistsQueryResult",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_artist",
        path: "/api/artists/get",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetArtistRequest",
        response_type: "Artist",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "delete_artist",
        path: "/api/artists/delete",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "DeleteArtistRequest",
        response_type: "DeleteArtistResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "update_artist",
        path: "/api/artists/update",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UpdateArtistRequest",
        response_type: "Artist",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "update_artist_metadata",
        path: "/api/artists/update-metadata",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UpdateArtistMetadataRequest",
        response_type: "UpdateArtistMetadataResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "get_artist_images",
        path: "/api/artists/images",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetArtistRequest",
        response_type: "Vec<String>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "propose_artist_bios",
        path: "/api/artists/propose-bios",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ProposeArtistBiosRequest",
        response_type: "ProposeArtistBiosResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "apply_artist_bio",
        path: "/api/artists/apply-bio",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ApplyArtistBioRequest",
        response_type: "ApplyArtistBioResult",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "propose_related_artists",
        path: "/api/artists/propose-related",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ProposeRelatedArtistsRequest",
        response_type: "ProposeRelatedArtistsResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "apply_related_artists",
        path: "/api/artists/apply-related",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ApplyRelatedArtistsRequest",
        response_type: "ApplyRelatedArtistsResult",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "image_candidates_for_artist",
        path: "/api/artists/image-candidates",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ArtistImageCandidatesRequest",
        response_type: "ArtistImageCandidatesResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
];

/// query artists
///
/// path: POST /api/artists/query
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

    let response = query_artists(params).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// create artist
///
/// path: POST /api/music/artists
pub async fn create(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: CreateArtistRequest = match serde_json::from_value(body) {
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

    let response = create_artist(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get artist by id
///
/// path: POST /api/artists/get
pub async fn get(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetArtistRequest = match serde_json::from_value(body) {
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

    let response = grimoire_get_artist(&req.id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get artist images
///
/// path: POST /api/artists/images
pub async fn get_images(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetArtistRequest = match serde_json::from_value(body) {
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

    let response = grimoire_get_artist_images(&req.id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// update artist
///
/// path: POST /api/artists/update
pub async fn update(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let mut req: UpdateArtistRequest = match serde_json::from_value(body) {
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

    let response = grimoire_update_artist(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// update artist enrichment metadata (phase 14.10)
///
/// path: POST /api/artists/update-metadata
///
/// admin-only. takes a typed `UpdateArtistMetadataRequest`. unlike the
/// general `/api/artists/update` route this one:
///
/// * never updates `name` (renames live in the artist detail view)
/// * merges `metadata_patch` per-source into the existing `artistz.metadata`
///   blob (`Some(_)` overwrites that bucket; `None` preserves)
/// * skips the write when the artist already has bio + image unless
///   `force = true`
pub async fn update_metadata(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let mut req: UpdateArtistMetadataRequest = match serde_json::from_value(body) {
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

    req.updated_by = Some(caller.user_id.clone());

    let response = grimoire_update_artist_metadata(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// delete artist
///
/// path: POST /api/artists/delete
pub async fn delete(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: DeleteArtistRequest = match serde_json::from_value(body) {
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

    let response = grimoire_delete_artist(&req.id, Some(caller.user_id.clone())).await;
    response.map(|_| JsonValue::Null)
}

/// list bio proposals for an artist (slice 4a)
///
/// reads `artistz.bio` + `artistz.metadata` (lastfm + audiodb snapshots)
/// and returns deduplicated `BioProposal`s for the bulk review wizard.
///
/// path: POST /api/artists/propose-bios
pub async fn propose_bios(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }
    let req: ProposeArtistBiosRequest = match serde_json::from_value(body) {
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
    let response = grimoire_propose_artist_bios(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// commit a chosen bio (slice 4a)
///
/// path: POST /api/artists/apply-bio
pub async fn apply_bio(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }
    let req: ApplyArtistBioRequest = match serde_json::from_value(body) {
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
    let response = grimoire_apply_artist_bio(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// list pending related-artist proposals (slice 4c)
///
/// path: POST /api/artists/propose-related
pub async fn propose_related(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }
    let req: ProposeRelatedArtistsRequest = match serde_json::from_value(body) {
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
    let response = grimoire_propose_related_artists(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// accept / reject related-artist proposals (slice 4c)
///
/// path: POST /api/artists/apply-related
pub async fn apply_related(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }
    let req: ApplyRelatedArtistsRequest = match serde_json::from_value(body) {
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
    let response = grimoire_apply_related_artists(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

// =============================================================================
// artist image candidates (slice 4b)
// =============================================================================

/// either resolves the artist by id directly, or — for the bulk
/// review wizard — by following an album back to its primary artist
/// (same `album_songz JOIN artist_songz` rule used by bio + related
/// proposals).
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, zod_gen_derive::ZodSchema)]
pub struct ArtistImageCandidatesRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album_id: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, zod_gen_derive::ZodSchema)]
pub struct ArtistImageCandidatesResponse {
    pub artist_id: String,
    pub candidates: Vec<crate::offal::music::albums::AlbumImageCandidate>,
    /// blob ids currently linked to the artist.
    pub ingested_blob_ids: Vec<String>,
}

/// surface remote image candidates for an artist from already-stored
/// metadata snapshots. read-only — never makes external http calls.
///
/// sources currently mined:
/// * `audiodb` — `artist_thumb`, `artist_fanart`
///
/// path: POST /api/artists/image-candidates
pub async fn image_candidates(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }
    let req: ArtistImageCandidatesRequest = match serde_json::from_value(body) {
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

    // resolve artist_id (either provided directly, or via album).
    let pool = match crate::database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };
    let artist_id = match (req.artist_id.as_deref(), req.album_id.as_deref()) {
        (Some(a), _) if !a.is_empty() => a.to_string(),
        (_, Some(album_id)) if !album_id.is_empty() => {
            match sqlx::query_scalar!(
                r#"SELECT artist_songz.artist_id as "artist_id!"
                   FROM album_songz
                   JOIN artist_songz ON artist_songz.song_id = album_songz.song_id
                   WHERE album_songz.album_id = ?
                   LIMIT 1"#,
                album_id
            )
            .fetch_optional(&pool)
            .await
            {
                Ok(Some(id)) => id,
                Ok(None) => {
                    return GrimoireResponse::failure(
                        "no artist for album",
                        vec![ErrorDetail::new(
                            "not_found",
                            "not found",
                            "no artist linked to album",
                        )],
                    )
                }
                Err(e) => {
                    return GrimoireResponse::failure(
                        "failed to resolve artist for album",
                        vec![ErrorDetail::from(e)],
                    )
                }
            }
        }
        _ => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    "one of artist_id or album_id is required",
                )],
            )
        }
    };

    // pull artist metadata blob.
    let row = match sqlx::query!(
        r#"SELECT metadata FROM artistz WHERE id = ? AND deleted_at IS NULL"#,
        artist_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(r)) => r,
        Ok(None) => {
            return GrimoireResponse::failure(
                "artist not found",
                vec![ErrorDetail::new(
                    "not_found",
                    "not found",
                    "artist row missing",
                )],
            )
        }
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to load artist metadata",
                vec![ErrorDetail::from(e)],
            )
        }
    };
    let meta =
        crate::music::entities::artists::metadata::ArtistMetadata::parse(row.metadata.as_deref());

    let mut candidates: Vec<crate::offal::music::albums::AlbumImageCandidate> = Vec::new();

    // audiodb artist images. priority order: thumb (cropped portrait)
    // before fanart (wide background).
    if let Some(ad) = meta.audiodb.as_ref() {
        if let Some(artist) = ad.artist.as_ref() {
            let pairs: [(&str, Option<&String>); 2] = [
                ("thumb", artist.artist_thumb.as_ref()),
                ("fanart", artist.artist_fanart.as_ref()),
            ];
            for (kind, url) in pairs {
                if let Some(u) = url {
                    let trimmed = u.trim();
                    if !trimmed.is_empty()
                        && (trimmed.starts_with("http://") || trimmed.starts_with("https://"))
                    {
                        candidates.push(crate::offal::music::albums::AlbumImageCandidate {
                            url: trimmed.to_string(),
                            source: "audiodb".to_string(),
                            kind: kind.to_string(),
                        });
                    }
                }
            }
        }
    }

    // currently-linked blob ids.
    let imgs_resp = grimoire_get_artist_images(&artist_id).await;
    let ingested = if imgs_resp.success {
        imgs_resp.data.unwrap_or_default()
    } else {
        Vec::new()
    };

    let resp = ArtistImageCandidatesResponse {
        artist_id,
        candidates,
        ingested_blob_ids: ingested,
    };
    GrimoireResponse::success(
        "artist image candidates",
        serde_json::to_value(resp).unwrap(),
    )
}
