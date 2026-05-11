//! theaudiodb http client.
//!
//! `https://www.theaudiodb.com/api/v1/json/{api_key}/{endpoint}` style. test
//! key `2` is included as the default in `AudioDbConfig` so callers can
//! kick the tires without paid access.

use crate::config::AudioDbConfig;
use crate::error::GrimoireError;
use crate::music::audiodb::models::{
    AudioDbAlbum, AudioDbAlbumLookupResponse, AudioDbArtist, AudioDbArtistLookupResponse,
    AudioDbSearchAlbumsResponse,
};
use crate::music::musicbrainz::rate_limiter::RateLimiter;
use crate::response::GrimoireResponse;
use reqwest::Client;
use serde::de::DeserializeOwned;
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn};

const USER_AGENT: &str = "freqhole/1.0 (https://github.com/freqhole/tomb)";
const BASE_URL: &str = "https://www.theaudiodb.com/api/v1/json";
const TIMEOUT_SECONDS: u64 = 30;
const RATE_LIMIT_MS: u64 = 1000;

#[derive(Debug, Clone)]
pub struct AudioDbClient {
    client: Client,
    config: Arc<AudioDbConfig>,
    rate_limiter: RateLimiter,
}

impl AudioDbClient {
    /// build a client; if `config.api_key` is empty (or set to a
    /// placeholder), falls back to the `AUDIODB_API_KEY` env var. accepts
    /// the public free key `"123"` if neither config nor env supplies one.
    pub fn new(mut config: AudioDbConfig) -> Result<Self, GrimoireError> {
        if config.api_key.trim().is_empty() {
            if let Ok(env_key) = std::env::var("AUDIODB_API_KEY") {
                if !env_key.trim().is_empty() {
                    config.api_key = env_key;
                }
            }
        }
        if config.api_key.trim().is_empty() {
            config.api_key = "123".to_string();
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

    /// `searchalbum.php?s={artist}&a={album}` — text search returning a
    /// list of album candidates (often just one). returns `Vec::new()` if
    /// audiodb has no record.
    pub async fn search_album(
        &self,
        artist: &str,
        album: &str,
    ) -> GrimoireResponse<Vec<AudioDbAlbum>> {
        info!("audiodb search_album artist={:?} album={:?}", artist, album);
        let path = "searchalbum.php";
        let params = [("s", artist), ("a", album)];
        match self
            .request::<AudioDbSearchAlbumsResponse>(path, &params)
            .await
        {
            Ok(resp) => {
                let v = resp.album.unwrap_or_default();
                info!("audiodb search_album: {} hits", v.len());
                GrimoireResponse::success("audiodb album search", v)
            }
            Err(e) => GrimoireResponse::failure("audiodb search_album failed", vec![e.into()]),
        }
    }

    /// `search.php?s={artist}` — artist text search. returns the first
    /// matching artist record (audiodb always returns 0 or 1 here in
    /// practice). useful for grabbing the artist's `idArtist` so we can
    /// then list their full discography.
    pub async fn search_artist(&self, artist: &str) -> GrimoireResponse<Option<AudioDbArtist>> {
        info!("audiodb search_artist artist={:?}", artist);
        let path = "search.php";
        let params = [("s", artist)];
        match self
            .request::<AudioDbArtistLookupResponse>(path, &params)
            .await
        {
            Ok(resp) => {
                let first = resp.artists.and_then(|mut v| {
                    if v.is_empty() {
                        None
                    } else {
                        Some(v.remove(0))
                    }
                });
                info!("audiodb search_artist: hit={}", first.is_some());
                GrimoireResponse::success("audiodb artist search", first)
            }
            Err(e) => GrimoireResponse::failure("audiodb search_artist failed", vec![e.into()]),
        }
    }

    /// `album.php?i={artist_id}` — list every album audiodb knows for an
    /// artist. used as a fallback when text-search by title misses (common
    /// for self-titled or oddly-punctuated releases).
    pub async fn albums_by_artist_id(
        &self,
        artist_id: &str,
    ) -> GrimoireResponse<Vec<AudioDbAlbum>> {
        info!("audiodb albums_by_artist_id artist_id={}", artist_id);
        let path = "album.php";
        let params = [("i", artist_id)];
        match self
            .request::<AudioDbSearchAlbumsResponse>(path, &params)
            .await
        {
            Ok(resp) => {
                let v = resp.album.unwrap_or_default();
                info!("audiodb albums_by_artist_id: {} albums", v.len());
                GrimoireResponse::success("audiodb artist discography", v)
            }
            Err(e) => {
                GrimoireResponse::failure("audiodb albums_by_artist_id failed", vec![e.into()])
            }
        }
    }

    /// `album-mb.php?i={mbid}` — direct lookup by musicbrainz release-group id.
    /// strongly preferred over text search when an mbid is available.
    pub async fn album_by_mbid(&self, mbid: &str) -> GrimoireResponse<Option<AudioDbAlbum>> {
        info!("audiodb album_by_mbid mbid={}", mbid);
        let path = "album-mb.php";
        let params = [("i", mbid)];
        match self
            .request::<AudioDbAlbumLookupResponse>(path, &params)
            .await
        {
            Ok(resp) => GrimoireResponse::success(
                "audiodb album by mbid",
                resp.album.and_then(|mut v| v.pop()),
            ),
            Err(e) => GrimoireResponse::failure("audiodb album_by_mbid failed", vec![e.into()]),
        }
    }

    /// `artist-mb.php?i={mbid}` — artist lookup by musicbrainz artist id.
    pub async fn artist_by_mbid(&self, mbid: &str) -> GrimoireResponse<Option<AudioDbArtist>> {
        info!("audiodb artist_by_mbid mbid={}", mbid);
        let path = "artist-mb.php";
        let params = [("i", mbid)];
        match self
            .request::<AudioDbArtistLookupResponse>(path, &params)
            .await
        {
            Ok(resp) => GrimoireResponse::success(
                "audiodb artist by mbid",
                resp.artists.and_then(|mut v| v.pop()),
            ),
            Err(e) => GrimoireResponse::failure("audiodb artist_by_mbid failed", vec![e.into()]),
        }
    }

    async fn request<T: DeserializeOwned>(
        &self,
        path: &str,
        params: &[(&str, &str)],
    ) -> Result<T, GrimoireError> {
        self.rate_limiter.wait_if_needed().await;

        let url = format!("{}/{}/{}", BASE_URL, self.config.api_key, path);
        let resp = self
            .client
            .get(&url)
            .query(params)
            .send()
            .await
            .map_err(|e| GrimoireError::HttpRequest(e.to_string()))?;

        let status = resp.status();
        let body = resp
            .text()
            .await
            .map_err(|e| GrimoireError::HttpRequest(e.to_string()))?;

        if !status.is_success() {
            warn!("audiodb http {}: {}", status, body);
            return Err(GrimoireError::ProcessingFailed {
                message: format!("audiodb http {}", status),
            });
        }

        serde_json::from_str::<T>(&body).map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("audiodb parse: {} body={}", e, body),
        })
    }
}
