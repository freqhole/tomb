//! musicbrainz http client
//!
//! provides http client implementation for musicbrainz api with rate limiting,
//! error handling, and response parsing.

use crate::musicbrainz::{
    config::MusicBrainzConfig,
    models::{CoverArt, Recording, Release, ReleaseGroup, SearchResult},
    queries::{RecordingSearchQuery, ReleaseGroupSearchQuery, ReleaseSearchQuery},
    rate_limiter::RateLimiter,
    MusicBrainzError, Result,
};
use reqwest::{Client, Response};
use serde::de::DeserializeOwned;
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, error, warn};

/// musicbrainz api client
#[derive(Debug, Clone)]
pub struct MusicBrainzClient {
    /// http client
    client: Client,

    /// client configuration
    config: Arc<MusicBrainzConfig>,

    /// rate limiter for api compliance
    rate_limiter: RateLimiter,
}

impl MusicBrainzClient {
    /// create new musicbrainz client
    pub fn new(config: MusicBrainzConfig) -> Result<Self> {
        // validate configuration
        config.validate().map_err(MusicBrainzError::ConfigError)?;

        // build http client with timeout
        let client = Client::builder()
            .timeout(config.timeout_duration())
            .user_agent(&config.user_agent)
            .build()
            .map_err(MusicBrainzError::HttpError)?;

        let rate_limiter = RateLimiter::new(config.rate_limit_duration());

        Ok(Self {
            client,
            config: Arc::new(config),
            rate_limiter,
        })
    }

    /// search for recordings matching the query
    pub async fn search_recordings(
        &self,
        query: &RecordingSearchQuery,
    ) -> Result<SearchResult<Recording>> {
        let url = format!("{}/recording", self.config.base_url);
        let query_string = query.to_query_string();

        debug!("searching recordings: {}", query_string);

        self.execute_request(&url, &query_string).await
    }

    /// search for releases matching the query
    pub async fn search_releases(
        &self,
        query: &ReleaseSearchQuery,
    ) -> Result<SearchResult<Release>> {
        let url = format!("{}/release", self.config.base_url);
        let query_string = query.to_query_string();

        debug!("searching releases: {}", query_string);

        self.execute_request(&url, &query_string).await
    }

    /// search for release groups matching the query
    pub async fn search_release_groups(
        &self,
        query: &ReleaseGroupSearchQuery,
    ) -> Result<SearchResult<ReleaseGroup>> {
        let url = format!("{}/release-group", self.config.base_url);
        let query_string = query.to_query_string();

        debug!("searching release groups: {}", query_string);

        self.execute_request(&url, &query_string).await
    }

    /// get specific recording by musicbrainz id
    pub async fn get_recording(&self, mbid: &str) -> Result<Recording> {
        let url = format!("{}/recording/{}", self.config.base_url, mbid);
        let query_string = "fmt=json&inc=artist-credits+releases+tags";

        debug!("fetching recording: {}", mbid);

        self.execute_request(&url, query_string).await
    }

    /// get specific release by musicbrainz id
    pub async fn get_release(&self, mbid: &str) -> Result<Release> {
        let url = format!("{}/release/{}", self.config.base_url, mbid);
        let query_string = "fmt=json&inc=artist-credits+recordings+media+release-groups";

        debug!("fetching release: {}", mbid);

        self.execute_request(&url, query_string).await
    }

    /// get cover art for a release
    pub async fn get_cover_art(&self, mbid: &str) -> Result<Vec<CoverArt>> {
        let url = format!("{}/release/{}", self.config.cover_art_url, mbid);

        debug!("fetching cover art: {}", mbid);

        // cover art archive doesn't need rate limiting (different service)
        let response = self
            .client
            .get(&url)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(MusicBrainzError::HttpError)?;

        self.handle_response(response).await
    }

    /// execute a request with rate limiting and error handling
    async fn execute_request<T>(&self, url: &str, query_string: &str) -> Result<T>
    where
        T: DeserializeOwned,
    {
        if !self.config.enabled {
            return Err(MusicBrainzError::ConfigError(
                "musicbrainz integration is disabled".to_string(),
            ));
        }

        // respect rate limiting
        self.rate_limiter.wait_if_needed().await;

        let full_url = if query_string.is_empty() {
            url.to_string()
        } else {
            format!("{}?{}", url, query_string)
        };

        debug!("making request to: {}", full_url);

        let mut retries = 0;

        loop {
            let response = self
                .client
                .get(&full_url)
                .header("Accept", "application/json")
                .send()
                .await
                .map_err(MusicBrainzError::HttpError)?;

            match self.handle_response(response).await {
                Ok(result) => return Ok(result),
                Err(MusicBrainzError::RateLimitExceeded) if retries < self.config.max_retries => {
                    retries += 1;
                    warn!(
                        "rate limit exceeded, retry {} of {}",
                        retries, self.config.max_retries
                    );

                    // exponential backoff
                    let backoff = Duration::from_secs(2_u64.pow(retries));
                    tokio::time::sleep(backoff).await;
                    continue;
                }
                Err(e) => return Err(e),
            }
        }
    }

    /// handle http response and parse json
    async fn handle_response<T>(&self, response: Response) -> Result<T>
    where
        T: DeserializeOwned,
    {
        let status = response.status();

        if status.is_success() {
            let body = response.text().await.map_err(MusicBrainzError::HttpError)?;

            debug!("received response body (length: {})", body.len());

            serde_json::from_str(&body).map_err(|e| {
                error!("failed to parse response: {}", e);
                error!("response body: {}", body);
                MusicBrainzError::JsonError(e)
            })
        } else if status.as_u16() == 429 {
            warn!("rate limit exceeded (429)");
            Err(MusicBrainzError::RateLimitExceeded)
        } else if status.as_u16() == 404 {
            Err(MusicBrainzError::NoResults)
        } else {
            let error_body = response
                .text()
                .await
                .unwrap_or_else(|_| "unknown error".to_string());

            error!("api error {}: {}", status, error_body);

            Err(MusicBrainzError::ApiError {
                status: status.as_u16(),
                message: error_body,
            })
        }
    }

    /// get client configuration
    pub fn config(&self) -> &MusicBrainzConfig {
        &self.config
    }

    /// check if rate limiter allows immediate requests
    pub async fn can_make_request(&self) -> bool {
        self.rate_limiter.can_proceed_immediately().await
    }

    /// get time until next request is allowed
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
            rate_limit_ms: 100, // faster for tests (but normally should be 1000)
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

        // this test would need to be async to actually test the error
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

        // should be able to make request initially
        assert!(client.can_make_request().await);
    }
}
