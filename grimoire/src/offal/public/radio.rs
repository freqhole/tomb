//! public radio discovery handlers.
//!
//! these endpoints are unauthenticated so anyone holding a node id can
//! list available stations + see what's currently playing. the actual
//! audio stream goes over the iroh `freqhole-radio/1` ALPN, not http.

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::media_blobz::{
    build_blob_data_response, build_blob_response, build_blob_thumbnail_response,
};
use crate::radio::broadcaster::list_running;
use crate::response::GrimoireResponse;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use zod_gen_derive::ZodSchema;

/// max long-edge size of the inline discovery thumbnail.
const THUMB_MAX_EDGE: u32 = 96;
/// jpeg quality for the inline discovery thumbnail.
const THUMB_JPEG_QUALITY: u8 = 70;
/// hard cap on the encoded thumb (base64 length). drops the field if exceeded.
const THUMB_BASE64_CAP: usize = 8 * 1024;

pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "radio_info",
        path: "/api/radio/info",
        method: Method::GET,
        domain: Domain::App,
        request_type: "String",
        response_type: "RadioInfoResponse",
        auth: RouteAuth::Public,
    },
    RouteInfo {
        name: "radio_stations",
        path: "/api/radio/stations",
        method: Method::GET,
        domain: Domain::App,
        request_type: "String",
        response_type: "RadioStationsResponse",
        auth: RouteAuth::Public,
    },
    RouteInfo {
        name: "radio_public_timeline",
        path: "/api/radio/stations/{station_id}/timeline",
        method: Method::GET,
        domain: Domain::App,
        request_type: "String",
        response_type: "PublicTimelineManifest",
        auth: RouteAuth::Public,
    },
    RouteInfo {
        name: "radio_public_blob",
        path: "/api/radio/stations/{station_id}/blobs/{blob_id}",
        method: Method::GET,
        domain: Domain::App,
        request_type: "String",
        response_type: "String",
        auth: RouteAuth::Public,
    },
    RouteInfo {
        name: "radio_public_blob_data",
        path: "/api/radio/stations/{station_id}/blobs/{blob_id}/data",
        method: Method::GET,
        domain: Domain::App,
        request_type: "String",
        response_type: "String",
        auth: RouteAuth::Public,
    },
    RouteInfo {
        name: "radio_public_blob_thumbnail",
        path: "/api/radio/stations/{station_id}/blobs/{blob_id}/thumb/{size}",
        method: Method::GET,
        domain: Domain::App,
        request_type: "String",
        response_type: "String",
        auth: RouteAuth::Public,
    },
];

/// dispatch radio public routes with path parameters.
pub async fn dispatch(path: &str) -> Option<GrimoireResponse<JsonValue>> {
    let rest = path.strip_prefix("/api/radio/stations/")?;

    if let Some(station_id) = rest.strip_suffix("/timeline") {
        if !station_id.is_empty() && !station_id.contains('/') {
            return Some(timeline(station_id).await);
        }
    }

    let (station_id, tail) = rest.split_once("/blobs/")?;

    if tail.ends_with("/data") {
        let blob_id = tail.strip_suffix("/data")?;
        return Some(get_public_blob_data(station_id, blob_id).await);
    }

    if let Some((blob_id, size)) = tail.split_once("/thumb/") {
        return Some(get_public_blob_thumbnail(station_id, blob_id, size).await);
    }

    Some(get_public_blob(station_id, tail).await)
}

/// public-facing snapshot of one running station.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PublicStation {
    pub station_id: String,
    pub name: String,
    pub description: Option<String>,
    pub listener_count: u32,
    pub is_default: bool,
    /// when true, any peer can connect + listen. when false, only peers
    /// in the local federation peer list may tune in (advertising still
    /// happens to every known peer either way; this just controls the
    /// per-station auth gate in the iroh handler).
    pub is_public: bool,
    pub now_playing: PublicNowPlaying,
}

/// the now-playing card without the binary art payload (clients fetch
/// art via the existing `/api/blobs/...` endpoints if they want it).
///
/// `art_thumb_b64` is a tiny (≤96px long edge, jpeg q70) preview that
/// non-tuned discovery clients can render inline without first
/// connecting to the radio stream. capped at ~8 kB; stations whose
/// art fails to encode just return `None`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, Default)]
pub struct PublicNowPlaying {
    pub song_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub art_blob_id: Option<String>,
    pub waveform_blob_id: Option<String>,
    pub duration_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub art_thumb_b64: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub art_thumb_mime: Option<String>,
}

/// `GET /api/radio/info` — single-station summary (the default channel).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioInfoResponse {
    pub enabled: bool,
    pub default_station: Option<PublicStation>,
    pub station_count: u32,
}

/// `GET /api/radio/stations` — every running channel.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioStationsResponse {
    pub enabled: bool,
    pub stations: Vec<PublicStation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PublicAssetRef {
    pub kind: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PublicTimelineManifestItem {
    pub timeline_item_id: String,
    pub song_id: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub start_at_ms: i64,
    #[serde(default)]
    pub duration_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub art: Option<PublicAssetRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub waveform: Option<PublicAssetRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PublicTimelineManifest {
    pub station_id: String,
    pub station_name: String,
    pub station_description: Option<String>,
    pub is_public: bool,
    pub broadcaster_timeline_only: bool,
    pub generated_at_ms: i64,
    pub timeline_seq: u64,
    pub lookahead_count: u64,
    #[serde(default)]
    pub current: Option<PublicTimelineManifestItem>,
    #[serde(default)]
    pub upcoming: Vec<PublicTimelineManifestItem>,
}

async fn load_public_station_context(
    station_id: &str,
) -> Result<
    (
        crate::radio::stations::models::RadioStation,
        std::sync::Arc<crate::radio::broadcaster::Broadcaster>,
    ),
    GrimoireResponse<JsonValue>,
> {
    let station = match crate::radio::stations::get_station(station_id).await {
        Ok(Some(s)) => s,
        Ok(None) => {
            return Err(GrimoireResponse::failure(
                "station not found",
                vec![ErrorDetail::new(
                    "station_not_found",
                    "station not found",
                    "no public radio station exists with that id",
                )],
            ))
        }
        Err(e) => {
            return Err(GrimoireResponse::failure(
                "failed to load station",
                vec![ErrorDetail::from(e)],
            ))
        }
    };

    if station.is_public == 0 {
        return Err(GrimoireResponse::failure(
            "station is not public",
            vec![ErrorDetail::new(
                "station_not_public",
                "station is not public",
                "public radio access is only available for public stations",
            )],
        ));
    }

    let bc = match crate::radio::broadcaster::get_station(station_id).await {
        Some(bc) => bc,
        None => {
            return Err(GrimoireResponse::failure(
                "station offline",
                vec![ErrorDetail::new(
                    "station_offline",
                    "station offline",
                    "the station is not currently running",
                )],
            ))
        }
    };

    Ok((station, bc))
}

fn public_blob_url(station_id: &str, blob_id: &str) -> String {
    format!("/api/radio/stations/{station_id}/blobs/{blob_id}")
}

fn public_manifest_current_item(
    station_id: &str,
    timeline: &crate::radio::messages::TimelineMessage,
    now_playing: &crate::radio::messages::NowPlaying,
) -> Option<PublicTimelineManifestItem> {
    let current = timeline.current.as_ref()?;
    Some(PublicTimelineManifestItem {
        timeline_item_id: current.timeline_item_id.clone(),
        song_id: current.song_id.clone(),
        title: Some(now_playing.title.clone()),
        artist: now_playing.artist.clone(),
        album: now_playing.album.clone(),
        start_at_ms: current.start_at_ms,
        duration_ms: current.duration_ms,
        art: now_playing.art.as_ref().map(|art| PublicAssetRef {
            kind: "image".to_string(),
            url: public_blob_url(station_id, &art.blob_id),
        }),
        waveform: now_playing
            .waveform_blob_id
            .as_ref()
            .map(|blob_id| PublicAssetRef {
                kind: "waveform".to_string(),
                url: public_blob_url(station_id, blob_id),
            }),
    })
}

async fn snapshot_station(
    bc: &std::sync::Arc<crate::radio::broadcaster::Broadcaster>,
    default_id: Option<&str>,
) -> PublicStation {
    let sub = bc.subscribe().await;
    let np = sub.now_playing.as_ref();
    // pull station name + visibility from the db; fall back to id if
    // the row vanished. private (is_public = 0) defaults to true on
    // the orphan-row path because the iroh handler can no longer find
    // the row to gate on either, so we err toward visible-but-private.
    let (name, description, is_public) =
        match crate::radio::stations::get_station(bc.station_id()).await {
            Ok(Some(s)) => (s.name, s.description, s.is_public != 0),
            _ => (bc.station_id().to_string(), None, false),
        };
    let (art_thumb_b64, art_thumb_mime) = np
        .art
        .as_ref()
        .and_then(|a| build_discovery_thumb(a))
        .map(|(b64, mime)| (Some(b64), Some(mime)))
        .unwrap_or((None, None));
    PublicStation {
        station_id: bc.station_id().to_string(),
        name,
        description,
        listener_count: bc.listener_count(),
        is_default: default_id == Some(bc.station_id()),
        is_public,
        now_playing: PublicNowPlaying {
            song_id: np.song_id.clone(),
            title: np.title.clone(),
            artist: np.artist.clone(),
            album: np.album.clone(),
            art_blob_id: np.art.as_ref().map(|a| a.blob_id.clone()),
            waveform_blob_id: np.waveform_blob_id.clone(),
            duration_ms: np.duration_ms,
            art_thumb_b64,
            art_thumb_mime,
        },
    }
}

/// downscale the broadcaster's full-size art into a discovery thumbnail.
/// returns `None` on any decode/encode failure or when the result blows
/// past `THUMB_BASE64_CAP`. always emits jpeg.
fn build_discovery_thumb(art: &crate::radio::messages::ArtData) -> Option<(String, String)> {
    let bytes = B64.decode(&art.data).ok()?;
    let img = image::load_from_memory(&bytes).ok()?;
    let resized = img.thumbnail(THUMB_MAX_EDGE, THUMB_MAX_EDGE);
    let rgb = resized.to_rgb8();
    let mut buf: Vec<u8> = Vec::with_capacity(4 * 1024);
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, THUMB_JPEG_QUALITY);
    image::ImageEncoder::write_image(
        encoder,
        &rgb,
        rgb.width(),
        rgb.height(),
        image::ColorType::Rgb8,
    )
    .ok()?;
    let b64 = B64.encode(&buf);
    if b64.len() > THUMB_BASE64_CAP {
        return None;
    }
    Some((b64, "image/jpeg".to_string()))
}

async fn ensure_public_station_blob_allowed(
    station_id: &str,
    blob_id: &str,
) -> Result<(), GrimoireResponse<JsonValue>> {
    let (_, bc) = load_public_station_context(station_id).await?;

    let now_playing = bc.now_playing().await;
    let allowed = now_playing
        .art
        .as_ref()
        .map(|art| art.blob_id == blob_id)
        .unwrap_or(false)
        || now_playing.waveform_blob_id.as_deref() == Some(blob_id);

    if !allowed {
        return Err(GrimoireResponse::failure(
            "blob not available for public station",
            vec![ErrorDetail::new(
                "radio_blob_not_available",
                "blob not available for public station",
                "this public blob route currently exposes only the station's current now-playing art and waveform assets",
            )],
        ));
    }

    Ok(())
}

pub async fn timeline(station_id: &str) -> GrimoireResponse<JsonValue> {
    let (station, bc) = match load_public_station_context(station_id).await {
        Ok(ctx) => ctx,
        Err(resp) => return resp,
    };

    let timeline = bc.timeline_snapshot(0).await;
    let now_playing = bc.now_playing().await;
    let manifest = PublicTimelineManifest {
        station_id: station.id,
        station_name: station.name,
        station_description: station.description,
        is_public: true,
        broadcaster_timeline_only: bc.is_timeline_only(),
        generated_at_ms: timeline.generated_at_ms,
        timeline_seq: timeline.timeline_seq,
        lookahead_count: timeline.lookahead_count as u64,
        current: public_manifest_current_item(station_id, &timeline, &now_playing),
        upcoming: Vec::new(),
    };

    GrimoireResponse::success("ok", serde_json::to_value(manifest).unwrap())
}

pub async fn get_public_blob(station_id: &str, blob_id: &str) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = ensure_public_station_blob_allowed(station_id, blob_id).await {
        return resp;
    }
    build_blob_response(blob_id).await
}

pub async fn get_public_blob_data(station_id: &str, blob_id: &str) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = ensure_public_station_blob_allowed(station_id, blob_id).await {
        return resp;
    }
    build_blob_data_response(blob_id).await
}

pub async fn get_public_blob_thumbnail(
    station_id: &str,
    blob_id: &str,
    size: &str,
) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = ensure_public_station_blob_allowed(station_id, blob_id).await {
        return resp;
    }
    let target_size = size.parse().unwrap_or(200);
    build_blob_thumbnail_response(blob_id, target_size).await
}

pub async fn info() -> GrimoireResponse<JsonValue> {
    let cfg = crate::radio::config::effective();
    if !cfg.enabled {
        return GrimoireResponse::success(
            "radio disabled",
            serde_json::to_value(RadioInfoResponse {
                enabled: false,
                default_station: None,
                station_count: 0,
            })
            .unwrap(),
        );
    }

    let running = list_running().await;
    let default_id = crate::radio::broadcaster::default_station_id();
    let default_station = match running.iter().find(|b| Some(b.station_id()) == default_id) {
        Some(bc) => Some(snapshot_station(bc, default_id).await),
        None => match running.first() {
            Some(bc) => Some(snapshot_station(bc, default_id).await),
            None => None,
        },
    };

    let resp = RadioInfoResponse {
        enabled: true,
        station_count: running.len() as u32,
        default_station,
    };
    GrimoireResponse::success("ok", serde_json::to_value(resp).unwrap())
}

pub async fn stations() -> GrimoireResponse<JsonValue> {
    let cfg = crate::radio::config::effective();
    if !cfg.enabled {
        return GrimoireResponse::success(
            "radio disabled",
            serde_json::to_value(RadioStationsResponse {
                enabled: false,
                stations: vec![],
            })
            .unwrap(),
        );
    }

    let running = list_running().await;
    let default_id = crate::radio::broadcaster::default_station_id();
    let mut out = Vec::with_capacity(running.len());
    for bc in &running {
        out.push(snapshot_station(bc, default_id).await);
    }
    // every running station is advertised to every caller. `is_public`
    // only controls *who can tune in* — peers not in the local peer
    // list get rejected by the iroh handler when `is_public = 0`. the
    // discovery surface stays open so peer + non-peer clients alike can
    // see what stations exist, and ui can render a "peer-only" badge
    // off the `is_public` field if it wants to.

    let resp = RadioStationsResponse {
        enabled: true,
        stations: out,
    };
    GrimoireResponse::success("ok", serde_json::to_value(resp).unwrap())
}
