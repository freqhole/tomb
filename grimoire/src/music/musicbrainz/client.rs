//! MusicBrainz HTTP client
//!
//! Provides HTTP client implementation for MusicBrainz API with rate limiting,
//! error handling, and response parsing.

use crate::error::GrimoireError;
use crate::music::musicbrainz::{
    config::MusicBrainzConfig,
    models::{CoverArt, CoverArtResponse, Recording, Release, ReleaseGroup, SearchResult},
    queries::{RecordingSearchQuery, ReleaseGroupSearchQuery, ReleaseSearchQuery},
    rate_limiter::RateLimiter,
};
use reqwest::{Client, Response};
use serde::de::DeserializeOwned;
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, error, warn};

/// MusicBrainz API client
#[derive(Debug, Clone)]
pub struct MusicBrainzClient {
    /// HTTP client
    client: Client,

    /// Client configuration
    config: Arc<MusicBrainzConfig>,

    /// Rate limiter for API compliance
    rate_limiter: RateLimiter,
}

impl MusicBrainzClient {
    /// Create new MusicBrainz client
    pub fn new(config: MusicBrainzConfig) -> Result<Self, GrimoireError> {
        // Validate configuration
        config
            .validate()
            .map_err(|e| GrimoireError::MusicBrainzConfig(e))?;

        // Build HTTP client with timeout
        let client = Client::builder()
            .timeout(config.timeout_duration())
            .user_agent(&config.user_agent)
            .build()
            .map_err(|e| GrimoireError::HttpRequest(e.to_string()))?;

        let rate_limiter = RateLimiter::new(config.rate_limit_duration());

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
    ) -> Result<SearchResult<Recording>, GrimoireError> {
        let url = format!("{}/recording", self.config.base_url);
        let query_string = query.to_query_string();

        debug!("Searching recordings: {}", query_string);

        self.execute_request(&url, &query_string).await
    }

    /// Search for releases matching the query
    pub async fn search_releases(
        &self,
        query: &ReleaseSearchQuery,
    ) -> Result<SearchResult<Release>, GrimoireError> {
        let url = format!("{}/release", self.config.base_url);
        let query_string = query.to_query_string();

        debug!("Searching releases: {}", query_string);

        self.execute_request(&url, &query_string).await
    }

    /// Search for release groups matching the query
    pub async fn search_release_groups(
        &self,
        query: &ReleaseGroupSearchQuery,
    ) -> Result<SearchResult<ReleaseGroup>, GrimoireError> {
        let url = format!("{}/release-group", self.config.base_url);
        let query_string = query.to_query_string();

        debug!("Searching release groups: {}", query_string);

        self.execute_request(&url, &query_string).await
    }

    /// Get specific recording by MusicBrainz ID
    pub async fn get_recording(&self, mbid: &str) -> Result<Recording, GrimoireError> {
        let url = format!("{}/recording/{}", self.config.base_url, mbid);
        let query_string = "fmt=json&inc=artist-credits+releases+tags";

        debug!("Fetching recording: {}", mbid);

        self.execute_request(&url, query_string).await
    }

    /// Get specific release by MusicBrainz ID
    pub async fn get_release(&self, mbid: &str) -> Result<Release, GrimoireError> {
        let url = format!("{}/release/{}", self.config.base_url, mbid);
        let query_string = "fmt=json&inc=artist-credits+recordings+media+release-groups";

        debug!("Fetching release: {}", mbid);

        self.execute_request(&url, query_string).await
    }

    /// Search for releases and automatically fetch cover art for each result
    /// This is more convenient than search_releases() + manual get_cover_art() calls
    pub async fn search_releases_with_cover_art(
        &self,
        query: &ReleaseSearchQuery,
    ) -> Result<Vec<(Release, Vec<CoverArt>)>, GrimoireError> {
        // First, search for releases
        let search_results = self.search_releases(query).await?;

        let mut results_with_art = Vec::new();

        // For each release, try to fetch cover art
        for release in search_results.results {
            let release_id = release.id.to_string();

            // Try to fetch cover art (might fail if none exists - that's ok)
            let cover_art = match self.get_cover_art(&release_id).await {
                Ok(art) => art,
                Err(GrimoireError::MusicBrainzNoResults) => {
                    // No cover art for this release - use empty vec
                    Vec::new()
                }
                Err(e) => {
                    // Other error - log but don't fail the whole search
                    warn!(
                        "Failed to fetch cover art for release {}: {}",
                        release_id, e
                    );
                    Vec::new()
                }
            };

            results_with_art.push((release, cover_art));
        }

        Ok(results_with_art)
    }

    /// Get cover art for a release
    pub async fn get_cover_art(&self, mbid: &str) -> Result<Vec<CoverArt>, GrimoireError> {
        let url = format!("{}/release/{}", self.config.cover_art_url, mbid);

        debug!("Fetching cover art: {}", mbid);

        // Cover art archive doesn't need rate limiting (different service)
        let response = self
            .client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| GrimoireError::HttpRequest(e.to_string()))?;

        let cover_art_response: CoverArtResponse = self.handle_response(response).await?;
        Ok(cover_art_response.images)
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
        self.rate_limiter.wait_if_needed().await;

        let full_url = if query_string.is_empty() {
            url.to_string()
        } else {
            format!("{}?{}", url, query_string)
        };

        debug!("Making request to: {}", full_url);

        let mut retries = 0;

        loop {
            let response = self
                .client
                .get(&full_url)
                .header("Accept", "application/json")
                .send()
                .await
                .map_err(|e| GrimoireError::HttpRequest(e.to_string()))?;

            match self.handle_response(response).await {
                Ok(result) => return Ok(result),
                Err(GrimoireError::MusicBrainzRateLimit) if retries < self.config.max_retries => {
                    retries += 1;
                    warn!(
                        "Rate limit exceeded, retry {} of {}",
                        retries, self.config.max_retries
                    );

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
        } else if status.as_u16() == 429 {
            warn!("Rate limit exceeded (429)");
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
        MusicBrainzConfig {
            enabled: true,
            user_agent: "test-client/1.0".to_string(),
            rate_limit_ms: 100, // Faster for tests (but normally should be 1000)
            ..Default::default()
        }
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

    #[test]
    fn test_invalid_config() {
        let mut config = test_config();
        config.user_agent = "".to_string();
        let result = MusicBrainzClient::new(config);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_rate_limiting() {
        let config = test_config();
        let client = MusicBrainzClient::new(config).unwrap();

        // Should be able to make request initially
        assert!(client.can_make_request().await);
    }
}
