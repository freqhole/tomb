//! MusicBrainz HTTP client
//!
//! Provides HTTP client implementation for MusicBrainz API with rate limiting,
//! error handling, and response parsing.

use crate::config::MusicBrainzConfig;
use crate::error::GrimoireError;
use crate::music::musicbrainz::{
    models::{CoverArt, CoverArtResponse, Recording, Release, ReleaseGroup, SearchResult},
    queries::{RecordingSearchQuery, ReleaseGroupSearchQuery, ReleaseSearchQuery},
    rate_limiter::RateLimiter,
};
use crate::response::GrimoireResponse;
use reqwest::{Client, Response};
use serde::de::DeserializeOwned;
use std::error::Error as StdError;
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, error, warn};

// hardcoded sensible defaults for musicbrainz api
const USER_AGENT: &str = "freqhole/1.0 (https://github.com/freqhole/tomb)";
const RATE_LIMIT_MS: u64 = 1000; // 1 second between requests (musicbrainz requirement)
const BASE_URL: &str = "https://musicbrainz.org/ws/2";
const COVER_ART_URL: &str = "https://coverartarchive.org";
const TIMEOUT_SECONDS: u64 = 30;
const MAX_RETRIES: u32 = 3;

/// MusicBrainz API client
#[derive(Debug, Clone)]
pub struct MusicBrainzClient {
    /// HTTP client
    client: Client,
    config: Arc<MusicBrainzConfig>,
    /// Rate limiter for API compliance
    rate_limiter: RateLimiter,
}

impl MusicBrainzClient {
    /// Create new MusicBrainz client with sensible defaults
    pub fn new(config: MusicBrainzConfig) -> Result<Self, GrimoireError> {
        // Build HTTP client with timeout
        let client = Client::builder()
            .timeout(Duration::from_secs(TIMEOUT_SECONDS))
            .user_agent(USER_AGENT)
            .build()
            .map_err(|e| GrimoireError::HttpRequest(e.to_string()))?;

        let rate_limiter = RateLimiter::new(Duration::from_millis(RATE_LIMIT_MS));

        Ok(Self {
            client,
            config: Arc::new(config),
            rate_limiter,
        })
    }

    /// Search for recordings matching the query
    pub async fn search_recordings(
        &self,
        query: &RecordingSearchQuery,
    ) -> GrimoireResponse<SearchResult<Recording>> {
        let url = format!("{}/recording", BASE_URL);
        let query_string = query.to_query_string();

        debug!("Searching recordings: {}", query_string);

        match self.execute_request(&url, &query_string).await {
            Ok(result) => GrimoireResponse::success("Successfully searched recordings", result),
            Err(e) => GrimoireResponse::failure("Failed to search recordings", vec![e.into()]),
        }
    }

    /// Search for releases matching the query
    pub async fn search_releases(
        &self,
        query: &ReleaseSearchQuery,
    ) -> GrimoireResponse<SearchResult<Release>> {
        let url = format!("{}/release", BASE_URL);
        let query_string = query.to_query_string();

        debug!("Searching releases: {}", query_string);

        match self.execute_request(&url, &query_string).await {
            Ok(result) => GrimoireResponse::success("Successfully searched releases", result),
            Err(e) => GrimoireResponse::failure("Failed to search releases", vec![e.into()]),
        }
    }

    /// Search for release groups matching the query
    pub async fn search_release_groups(
        &self,
        query: &ReleaseGroupSearchQuery,
    ) -> GrimoireResponse<SearchResult<ReleaseGroup>> {
        let url = format!("{}/release-group", BASE_URL);
        let query_string = query.to_query_string();

        debug!("Searching release groups: {}", query_string);

        match self.execute_request(&url, &query_string).await {
            Ok(result) => GrimoireResponse::success("Successfully searched release groups", result),
            Err(e) => GrimoireResponse::failure("Failed to search release groups", vec![e.into()]),
        }
    }

    /// Get specific recording by MusicBrainz ID
    pub async fn get_recording(&self, mbid: &str) -> GrimoireResponse<Recording> {
        let url = format!("{}/recording/{}", BASE_URL, mbid);
        let query_string = "fmt=json&inc=artist-credits+releases+tags";

        debug!("Fetching recording: {}", mbid);

        match self.execute_request(&url, query_string).await {
            Ok(result) => GrimoireResponse::success("Successfully fetched recording", result),
            Err(e) => GrimoireResponse::failure("Failed to fetch recording", vec![e.into()]),
        }
    }

    /// Get specific release by MusicBrainz ID
    pub async fn get_release(&self, mbid: &str) -> GrimoireResponse<Release> {
        let url = format!("{}/release/{}", BASE_URL, mbid);
        let query_string =
            "fmt=json&inc=artist-credits+recordings+media+release-groups+labels+genres+tags+url-rels";

        debug!("Fetching release: {}", mbid);

        match self.execute_request(&url, query_string).await {
            Ok(result) => GrimoireResponse::success("Successfully fetched release", result),
            Err(e) => GrimoireResponse::failure("Failed to fetch release", vec![e.into()]),
        }
    }

    /// Get specific release group by MusicBrainz ID, with folksonomy data
    /// (genres + tags) and artist credits.
    pub async fn get_release_group(&self, mbid: &str) -> GrimoireResponse<ReleaseGroup> {
        let url = format!("{}/release-group/{}", BASE_URL, mbid);
        let query_string = "fmt=json&inc=artist-credits+genres+tags+url-rels";

        debug!("Fetching release-group: {}", mbid);

        match self.execute_request(&url, query_string).await {
            Ok(result) => GrimoireResponse::success("Successfully fetched release-group", result),
            Err(e) => GrimoireResponse::failure("Failed to fetch release-group", vec![e.into()]),
        }
    }

    /// Get specific artist by MusicBrainz ID with url relations.
    /// the artist endpoint is by far the richest source of external
    /// links (bandcamp, allmusic, last.fm, songkick, streaming
    /// services, discogs, wikidata, etc.) — the release/release-group
    /// endpoints typically only carry a handful of release-specific
    /// links (free streaming, review, wikidata).
    pub async fn get_artist(&self, mbid: &str) -> GrimoireResponse<crate::music::musicbrainz::models::Artist> {
        let url = format!("{}/artist/{}", BASE_URL, mbid);
        let query_string = "fmt=json&inc=url-rels";

        debug!("Fetching artist: {}", mbid);

        match self.execute_request(&url, query_string).await {
            Ok(result) => GrimoireResponse::success("Successfully fetched artist", result),
            Err(e) => GrimoireResponse::failure("Failed to fetch artist", vec![e.into()]),
        }
    }

    /// Search for releases and automatically fetch cover art for each result
    /// This is more convenient than search_releases() + manual get_cover_art() calls
    pub async fn search_releases_with_cover_art(
        &self,
        query: &ReleaseSearchQuery,
    ) -> GrimoireResponse<Vec<(Release, Vec<CoverArt>)>> {
        // First, search for releases
        let search_results = match self.search_releases(query).await {
            response if response.success => match response.data {
                Some(data) => data,
                None => {
                    return GrimoireResponse::failure(
                        "Search succeeded but contained no data",
                        vec![],
                    )
                }
            },
            response => {
                return GrimoireResponse::failure("Failed to search releases", response.errors)
            }
        };

        let mut results_with_art = Vec::new();

        // For each release, try to fetch cover art
        for release in search_results.results {
            let release_id = release.id.to_string();

            // Try to fetch cover art (might fail if none exists - that's ok)
            let cover_art_response = self.get_cover_art(&release_id).await;
            let cover_art = if cover_art_response.success {
                cover_art_response.data.unwrap_or_default()
            } else {
                // Log but don't fail the whole search
                warn!(
                    "Failed to fetch cover art for release {}: {:?}",
                    release_id, cover_art_response.errors
                );
                Vec::new()
            };

            results_with_art.push((release, cover_art));
        }

        GrimoireResponse::success(
            "Successfully searched releases with cover art",
            results_with_art,
        )
    }

    /// Get cover art for a release
    pub async fn get_cover_art(&self, mbid: &str) -> GrimoireResponse<Vec<CoverArt>> {
        let url = format!("{}/release/{}", COVER_ART_URL, mbid);

        debug!("Fetching cover art: {}", mbid);

        // Cover art archive doesn't need rate limiting (different service)
        let response = match self
            .client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                return GrimoireResponse::failure(
                    "Failed to request cover art",
                    vec![GrimoireError::HttpRequest(e.to_string()).into()],
                )
            }
        };

        let cover_art_response: CoverArtResponse = match self.handle_response(response).await {
            Ok(r) => r,
            Err(e) => {
                return GrimoireResponse::failure(
                    "Failed to parse cover art response",
                    vec![e.into()],
                )
            }
        };

        GrimoireResponse::success("Successfully fetched cover art", cover_art_response.images)
    }

    /// Execute a request with rate limiting and error handling
    async fn execute_request<T>(&self, url: &str, query_string: &str) -> Result<T, GrimoireError>
    where
        T: DeserializeOwned,
    {
        if !self.config.enabled {
            return Err(GrimoireError::MusicBrainzConfig(
                "MusicBrainz integration is disabled".to_string(),
            ));
        }

        // Respect rate limiting
        let full_url = if query_string.is_empty() {
            url.to_string()
        } else {
            format!("{}?{}", url, query_string)
        };

        debug!("Making request to: {}", full_url);

        let mut retries = 0;

        loop {
            // respect rate limiting before each attempt
            self.rate_limiter.wait_if_needed().await;

            let response = match self
                .client
                .get(&full_url)
                .header("Accept", "application/json")
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    // connection-level errors (resets, timeouts) — retry with backoff
                    let is_timeout = e.is_timeout();
                    let is_connect = e.is_connect();
                    let source_chain = {
                        let mut chain = vec![e.to_string()];
                        let mut source = e.source();
                        while let Some(s) = source {
                            chain.push(s.to_string());
                            source = s.source();
                        }
                        chain.join(" -> ")
                    };

                    if retries < MAX_RETRIES {
                        retries += 1;
                        let backoff = Duration::from_secs(2_u64.pow(retries));
                        warn!(
                            "connection error (attempt {}/{}), retrying in {:?}: {}",
                            retries, MAX_RETRIES, backoff, source_chain
                        );
                        tokio::time::sleep(backoff).await;
                        continue;
                    }

                    error!(
                        "request failed after {} retries: timeout={} connect={} | {}",
                        MAX_RETRIES, is_timeout, is_connect, source_chain
                    );
                    // treat exhausted connection errors as rate limiting
                    // (musicbrainz resets connections when overloaded)
                    return Err(GrimoireError::MusicBrainzRateLimit);
                }
            };

            match self.handle_response(response).await {
                Ok(result) => return Ok(result),
                Err(GrimoireError::MusicBrainzRateLimit) if retries < MAX_RETRIES => {
                    retries += 1;
                    warn!("Rate limit exceeded, retry {} of {}", retries, MAX_RETRIES);

                    // Exponential backoff
                    let backoff = Duration::from_secs(2_u64.pow(retries));
                    tokio::time::sleep(backoff).await;
                    continue;
                }
                Err(e) => return Err(e),
            }
        }
    }

    /// Handle HTTP response and parse JSON
    async fn handle_response<T>(&self, response: Response) -> Result<T, GrimoireError>
    where
        T: DeserializeOwned,
    {
        let status = response.status();

        if status.is_success() {
            let body = response
                .text()
                .await
                .map_err(|e| GrimoireError::HttpRequest(e.to_string()))?;

            debug!("Received response body (length: {})", body.len());

            serde_json::from_str(&body).map_err(|e| {
                error!("Failed to parse response: {}", e);
                error!("Response body: {}", body);
                GrimoireError::Serialization(e)
            })
        } else if status.as_u16() == 429 || status.as_u16() == 503 {
            // musicbrainz uses both 429 and 503 for rate limiting
            warn!("Rate limit exceeded ({})", status.as_u16());
            Err(GrimoireError::MusicBrainzRateLimit)
        } else if status.as_u16() == 404 {
            Err(GrimoireError::MusicBrainzNoResults)
        } else {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "unknown error".to_string());

            error!("API error {}: {}", status, error_body);

            Err(GrimoireError::MusicBrainzApi(format!(
                "HTTP {}: {}",
                status, error_body
            )))
        }
    }

    /// Get client configuration
    pub fn config(&self) -> &MusicBrainzConfig {
        &self.config
    }

    /// Check if rate limiter allows immediate requests
    pub async fn can_make_request(&self) -> bool {
        self.rate_limiter.can_proceed_immediately().await
    }

    /// Get time until next request is allowed
    pub async fn time_until_next_request(&self) -> Duration {
        self.rate_limiter.time_until_next_request().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> MusicBrainzConfig {
        MusicBrainzConfig { enabled: true }
    }

    #[test]
    fn test_client_creation() {
        let config = test_config();
        let client = MusicBrainzClient::new(config);
        assert!(client.is_ok());
    }

    #[test]
    fn test_disabled_client() {
        let mut config = test_config();
        config.enabled = false;
        let client = MusicBrainzClient::new(config).unwrap();

        assert!(!client.config.enabled);
    }

    #[tokio::test]
    async fn test_rate_limiting() {
        let config = test_config();
        let client = MusicBrainzClient::new(config).unwrap();

        // Should be able to make request initially
        assert!(client.can_make_request().await);
    }
}
