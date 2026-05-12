//! last.fm 2.0 web api http client.
//!
//! all calls hit `https://ws.audioscrobbler.com/2.0/` with `format=json` and
//! the api key from `LastFmConfig`. errors are returned as a structured
//! `LastFmErrorEnvelope` per the api docs (e.g. error=6 == artist not found).
//!
//! rate limit: 1 req/sec (we share the same `RateLimiter` impl as
//! musicbrainz to keep things simple and well under the documented cap).

use crate::config::LastFmConfig;
use crate::error::GrimoireError;
use crate::music::musicbrainz::rate_limiter::RateLimiter;
use crate::response::GrimoireResponse;
use reqwest::Client;
use serde::de::DeserializeOwned;
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn};

use super::models::{
    LastFmAlbumInfo, LastFmAlbumInfoResponse, LastFmArtistInfo, LastFmArtistInfoResponse,
    LastFmErrorEnvelope,
};

const USER_AGENT: &str = "freqhole/1.0 (https://github.com/freqhole/tomb)";
const BASE_URL: &str = "https://ws.audioscrobbler.com/2.0/";
const TIMEOUT_SECONDS: u64 = 30;
const RATE_LIMIT_MS: u64 = 1000;

#[derive(Debug, Clone)]
pub struct LastFmClient {
    client: Client,
    config: Arc<LastFmConfig>,
    rate_limiter: RateLimiter,
}

/// returns true when last.fm has a usable api key (either in config
/// or via the `LASTFM_API_KEY` env var). callers can use this to skip
/// enqueuing dead jobs without trying to construct a client.
pub fn lastfm_is_configured(config: &LastFmConfig) -> bool {
    if !config.api_key.trim().is_empty() {
        return true;
    }
    matches!(std::env::var("LASTFM_API_KEY"), Ok(k) if !k.trim().is_empty())
}

impl LastFmClient {
    /// build a client; if `config.api_key` is empty, falls back to the
    /// `LASTFM_API_KEY` environment variable (handy for dev where the key
    /// shouldn't live in the toml file).
    pub fn new(mut config: LastFmConfig) -> Result<Self, GrimoireError> {
        if config.api_key.trim().is_empty() {
            if let Ok(env_key) = std::env::var("LASTFM_API_KEY") {
                if !env_key.trim().is_empty() {
                    config.api_key = env_key;
                }
            }
        }
        if config.api_key.trim().is_empty() {
            return Err(GrimoireError::ProcessingFailed {
                message:
                    "last.fm api_key is empty (set [lastfm].api_key or LASTFM_API_KEY env var)"
                        .to_string(),
            });
        }
        let client = Client::builder()
            .timeout(Duration::from_secs(TIMEOUT_SECONDS))
            .user_agent(USER_AGENT)
            .build()
            .map_err(|e| GrimoireError::HttpRequest(e.to_string()))?;
        Ok(Self {
            client,
            config: Arc::new(config),
            rate_limiter: RateLimiter::new(Duration::from_millis(RATE_LIMIT_MS)),
        })
    }

    /// `album.getInfo` — wiki summary, top tags (folksonomy), play counts.
    /// prefers mbid lookup if provided. if the mbid lookup returns
    /// "not found" (last.fm error 6) and we also have an artist+album
    /// pair, retries once without the mbid — last.fm's mbid index is
    /// patchy and often misses release-group ids that musicbrainz has.
    pub async fn album_get_info(
        &self,
        artist: &str,
        album: &str,
        mbid: Option<&str>,
    ) -> GrimoireResponse<LastFmAlbumInfo> {
        if let Some(id) = mbid {
            let params: Vec<(&str, &str)> = vec![
                ("method", "album.getinfo"),
                ("autocorrect", "1"),
                ("mbid", id),
            ];
            info!(
                "lastfm album.getInfo (mbid) artist={:?} album={:?} mbid={:?}",
                artist, album, mbid
            );
            match self
                .request::<LastFmAlbumInfoResponse>(&params)
                .await
                .and_then(|r| {
                    r.album.ok_or_else(|| GrimoireError::ProcessingFailed {
                        message: "lastfm album.getInfo: no album in response".to_string(),
                    })
                }) {
                Ok(info) => return GrimoireResponse::success("lastfm album info", info),
                Err(e) => {
                    let msg = format!("{}", e);
                    let is_not_found = msg.contains("error 6") || msg.contains("not found");
                    if !(is_not_found && !artist.is_empty() && !album.is_empty()) {
                        return GrimoireResponse::failure(
                            "lastfm album.getInfo failed",
                            vec![e.into()],
                        );
                    }
                    warn!(
                        "lastfm album.getInfo mbid={:?} not found; retrying with artist+album",
                        mbid
                    );
                }
            }
        }

        let params: Vec<(&str, &str)> = vec![
            ("method", "album.getinfo"),
            ("autocorrect", "1"),
            ("artist", artist),
            ("album", album),
        ];
        info!(
            "lastfm album.getInfo (text) artist={:?} album={:?}",
            artist, album
        );
        match self
            .request::<LastFmAlbumInfoResponse>(&params)
            .await
            .and_then(|r| {
                r.album.ok_or_else(|| GrimoireError::ProcessingFailed {
                    message: "lastfm album.getInfo: no album in response".to_string(),
                })
            }) {
            Ok(info) => GrimoireResponse::success("lastfm album info", info),
            Err(e) => GrimoireResponse::failure("lastfm album.getInfo failed", vec![e.into()]),
        }
    }

    /// `artist.getInfo` — bio, similar artists, top tags. retries
    /// without `mbid` if the mbid lookup returns not-found and an
    /// artist name is available.
    pub async fn artist_get_info(
        &self,
        artist: &str,
        mbid: Option<&str>,
    ) -> GrimoireResponse<LastFmArtistInfo> {
        if let Some(id) = mbid {
            let params: Vec<(&str, &str)> = vec![
                ("method", "artist.getinfo"),
                ("autocorrect", "1"),
                ("mbid", id),
            ];
            info!(
                "lastfm artist.getInfo (mbid) artist={:?} mbid={:?}",
                artist, mbid
            );
            match self
                .request::<LastFmArtistInfoResponse>(&params)
                .await
                .and_then(|r| {
                    r.artist.ok_or_else(|| GrimoireError::ProcessingFailed {
                        message: "lastfm artist.getInfo: no artist in response".to_string(),
                    })
                }) {
                Ok(info) => return GrimoireResponse::success("lastfm artist info", info),
                Err(e) => {
                    let msg = format!("{}", e);
                    let is_not_found = msg.contains("error 6") || msg.contains("not found");
                    if !(is_not_found && !artist.is_empty()) {
                        return GrimoireResponse::failure(
                            "lastfm artist.getInfo failed",
                            vec![e.into()],
                        );
                    }
                    warn!(
                        "lastfm artist.getInfo mbid={:?} not found; retrying with artist name",
                        mbid
                    );
                }
            }
        }

        let params: Vec<(&str, &str)> = vec![
            ("method", "artist.getinfo"),
            ("autocorrect", "1"),
            ("artist", artist),
        ];
        info!("lastfm artist.getInfo (text) artist={:?}", artist);
        match self
            .request::<LastFmArtistInfoResponse>(&params)
            .await
            .and_then(|r| {
                r.artist.ok_or_else(|| GrimoireError::ProcessingFailed {
                    message: "lastfm artist.getInfo: no artist in response".to_string(),
                })
            }) {
            Ok(info) => GrimoireResponse::success("lastfm artist info", info),
            Err(e) => GrimoireResponse::failure("lastfm artist.getInfo failed", vec![e.into()]),
        }
    }

    async fn request<T: DeserializeOwned>(
        &self,
        extra_params: &[(&str, &str)],
    ) -> Result<T, GrimoireError> {
        self.rate_limiter.wait_if_needed().await;

        let api_key = self.config.api_key.clone();
        let mut params: Vec<(&str, &str)> = Vec::with_capacity(extra_params.len() + 2);
        params.extend_from_slice(extra_params);
        params.push(("api_key", api_key.as_str()));
        params.push(("format", "json"));

        let resp = self
            .client
            .get(BASE_URL)
            .query(&params)
            .send()
            .await
            .map_err(|e| GrimoireError::HttpRequest(e.to_string()))?;

        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| GrimoireError::HttpRequest(e.to_string()))?;

        if !status.is_success() {
            warn!("lastfm http {}: {}", status, body);
            return Err(GrimoireError::ProcessingFailed {
                message: format!("lastfm http {}", status),
            });
        }

        // last.fm returns 200 + an error envelope for typed failures
        if let Ok(envelope) = serde_json::from_str::<LastFmErrorEnvelope>(&body) {
            warn!("lastfm api error {}: {}", envelope.error, envelope.message);
            return Err(GrimoireError::ProcessingFailed {
                message: format!("lastfm error {}: {}", envelope.error, envelope.message),
            });
        }

        serde_json::from_str::<T>(&body).map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("lastfm parse: {} body={}", e, body),
        })
    }
}
