//! last.fm 2.0 web api http client.
//!
//! all calls hit `https://ws.audioscrobbler.com/2.0/` with `format=json` and
//! the api key from `LastFmConfig`. errors are returned as a structured
//! `LastFmErrorEnvelope` per the api docs (e.g. error=6 == artist not found).
//!
//! rate limiting is handled by the global gate in `crate::jobs::rate_limit`;
//! the client retries 429/503 up to 3 times honoring `Retry-After`.

use crate::config::LastFmConfig;
use crate::error::GrimoireError;
use crate::response::GrimoireResponse;
use reqwest::Client;
use serde::de::DeserializeOwned;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tracing::{info, warn};

use super::models::{
    LastFmAlbumInfo, LastFmAlbumInfoResponse, LastFmArtistInfo, LastFmArtistInfoResponse,
    LastFmErrorEnvelope, LastFmGetSimilarArtist, LastFmGetSimilarResponse,
};

const USER_AGENT: &str = "freqhole/1.0 (https://github.com/freqhole/tomb)";
const BASE_URL: &str = "https://ws.audioscrobbler.com/2.0/";
const TIMEOUT_SECONDS: u64 = 30;
const MAX_RETRIES: u32 = 3;

/// return the shared, long-lived http client for last.fm.
fn shared_http_client() -> &'static Client {
    static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();
    HTTP_CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(Duration::from_secs(TIMEOUT_SECONDS))
            .user_agent(USER_AGENT)
            .build()
            .expect("failed to build last.fm http client")
    })
}

/// parse a `Retry-After` response header into a sleep duration.
/// handles delta-seconds; falls back to `None` for HTTP-date or unparseable
/// values so the caller uses exponential backoff. capped at 5 minutes.
fn parse_retry_after(resp: &reqwest::Response) -> Option<Duration> {
    let val = resp.headers().get("retry-after")?.to_str().ok()?;
    let secs: u64 = val.trim().parse().ok()?;
    Some(Duration::from_secs(secs.min(300)))
}

#[derive(Debug, Clone)]
pub struct LastFmClient {
    client: Client,
    config: Arc<LastFmConfig>,
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
        let client = shared_http_client().clone();
        Ok(Self {
            client,
            config: Arc::new(config),
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
                    if !is_not_found || artist.is_empty() {
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

    /// `artist.getSimilar` — richer than `artist.getInfo.similar`:
    /// includes a numeric `match` score and accepts `limit` (default
    /// 100, we cap at 25 by default callsites). prefers mbid lookup
    /// when available; falls back to artist name.
    pub async fn artist_get_similar(
        &self,
        artist: &str,
        mbid: Option<&str>,
        limit: u32,
    ) -> GrimoireResponse<Vec<LastFmGetSimilarArtist>> {
        let limit_str = limit.to_string();
        if let Some(id) = mbid {
            let params: Vec<(&str, &str)> = vec![
                ("method", "artist.getsimilar"),
                ("autocorrect", "1"),
                ("mbid", id),
                ("limit", &limit_str),
            ];
            info!(
                "lastfm artist.getSimilar (mbid) artist={:?} mbid={:?} limit={}",
                artist, mbid, limit
            );
            match self
                .request::<LastFmGetSimilarResponse>(&params)
                .await
                .map(|r| r.similarartists.map(|w| w.artist).unwrap_or_default())
            {
                Ok(list) => return GrimoireResponse::success("lastfm similar artists", list),
                Err(e) => {
                    let msg = format!("{}", e);
                    let is_not_found = msg.contains("error 6") || msg.contains("not found");
                    if !is_not_found || artist.is_empty() {
                        return GrimoireResponse::failure(
                            "lastfm artist.getSimilar failed",
                            vec![e.into()],
                        );
                    }
                    warn!(
                        "lastfm artist.getSimilar mbid={:?} not found; retrying with name",
                        mbid
                    );
                }
            }
        }

        let params: Vec<(&str, &str)> = vec![
            ("method", "artist.getsimilar"),
            ("autocorrect", "1"),
            ("artist", artist),
            ("limit", &limit_str),
        ];
        info!(
            "lastfm artist.getSimilar (text) artist={:?} limit={}",
            artist, limit
        );
        match self
            .request::<LastFmGetSimilarResponse>(&params)
            .await
            .map(|r| r.similarartists.map(|w| w.artist).unwrap_or_default())
        {
            Ok(list) => GrimoireResponse::success("lastfm similar artists", list),
            Err(e) => GrimoireResponse::failure("lastfm artist.getSimilar failed", vec![e.into()]),
        }
    }

    async fn request<T: DeserializeOwned>(
        &self,
        extra_params: &[(&str, &str)],
    ) -> Result<T, GrimoireError> {
        let api_key = self.config.api_key.clone();
        let mut params: Vec<(&str, &str)> = Vec::with_capacity(extra_params.len() + 2);
        params.extend_from_slice(extra_params);
        params.push(("api_key", api_key.as_str()));
        params.push(("format", "json"));

        let mut attempt = 0u32;
        loop {
            let resp = self
                .client
                .get(BASE_URL)
                .query(&params)
                .send()
                .await
                .map_err(|e| GrimoireError::HttpRequest(e.to_string()))?;

            let status = resp.status();
            if (status.as_u16() == 429 || status.as_u16() == 503) && attempt < MAX_RETRIES {
                let backoff = parse_retry_after(&resp)
                    .unwrap_or_else(|| Duration::from_secs(2_u64.pow(attempt + 1)));
                attempt += 1;
                warn!(
                    "lastfm http {} (attempt {}/{}), retrying in {:?}",
                    status, attempt, MAX_RETRIES, backoff
                );
                tokio::time::sleep(backoff).await;
                continue;
            }

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

            return serde_json::from_str::<T>(&body).map_err(|e| GrimoireError::ProcessingFailed {
                message: format!("lastfm parse: {} body={}", e, body),
            });
        }
    }
}
