//! public radio discovery handlers.
//!
//! these endpoints are unauthenticated so anyone holding a node id can
//! list available stations + see what's currently playing. the actual
//! audio stream goes over the iroh `freqhole-radio/1` ALPN, not http.

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
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
];

/// public-facing snapshot of one running station.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PublicStation {
    pub station_id: String,
    pub name: String,
    pub description: Option<String>,
    pub listener_count: u32,
    pub is_default: bool,
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

async fn snapshot_station(
    bc: &std::sync::Arc<crate::radio::broadcaster::Broadcaster>,
    default_id: Option<&str>,
) -> PublicStation {
    let sub = bc.subscribe().await;
    let np = sub.now_playing.as_ref();
    // pull station name from the db; fall back to id if the row vanished.
    let (name, description) = match crate::radio::stations::get_station(bc.station_id()).await {
        Ok(Some(s)) => (s.name, s.description),
        _ => (bc.station_id().to_string(), None),
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
    // surface server-wide non-public stations are still listed (the iroh
    // handler does its own auth gating); ui can decide to hide them.
    // when we want to hide non-public from the response entirely, add a
    // join on `is_public = 1` in stations::list_stations.

    let resp = RadioStationsResponse {
        enabled: true,
        stations: out,
    };
    GrimoireResponse::success("ok", serde_json::to_value(resp).unwrap())
}
