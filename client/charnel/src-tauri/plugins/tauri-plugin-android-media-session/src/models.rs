use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMetadataPayload {
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_ms: Option<i64>,
    /// base64-encoded image bytes (webp/png/jpeg). android decodes via
    /// BitmapFactory which supports all three.
    pub artwork_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPlaybackStatePayload {
    /// "playing" | "paused" | "stopped"
    pub state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPositionPayload {
    pub position_ms: i64,
    pub duration_ms: i64,
    pub playback_rate: f32,
}
