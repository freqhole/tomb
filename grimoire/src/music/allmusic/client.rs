//! allmusic via apify scraper http client (scaffold).
//!
//! one-shot synchronous flow:
//!     POST {APIFY_BASE}/acts/{ACTOR_ID}/run-sync-get-dataset-items?token=...
//!     body: AllMusicScraperInput
//!     response: Vec<AllMusicAlbum> (one per query)
//!
//! the actor can take 30s+ per query in cold-start; we set a generous
//! default timeout and let callers override.
//!
//! safety: no batching loop here — callers must explicitly enqueue per
//! album and respect the user's "do not background-fetch" policy.

use crate::config::AllMusicConfig;
use crate::error::GrimoireError;
use crate::music::allmusic::models::{AllMusicAlbum, AllMusicScraperInput};
use crate::response::GrimoireResponse;
use reqwest::Client;
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn};

const USER_AGENT: &str = "freqhole/1.0 (https://github.com/freqhole/tomb)";
const APIFY_BASE: &str = "https://api.apify.com/v2";
/// default actor identifier; overridable via `AllMusicConfig::actor_id`.
const DEFAULT_ACTOR_ID: &str = "lexis-solutions~allmusic-scraper";
/// default upper bound on a single sync run. allmusic scraping is slow.
const DEFAULT_TIMEOUT_SECONDS: u64 = 180;

#[derive(Debug, Clone)]
pub struct AllMusicClient {
    client: Client,
    config: Arc<AllMusicConfig>,
}

impl AllMusicClient {
    pub fn new(config: AllMusicConfig) -> Result<Self, GrimoireError> {
        if config.api_token.trim().is_empty() {
            return Err(GrimoireError::ProcessingFailed {
                message: "allmusic (apify) api_token is empty".to_string(),
            });
        }
        let timeout =
            Duration::from_secs(config.timeout_seconds.unwrap_or(DEFAULT_TIMEOUT_SECONDS));
        let client = Client::builder()
            .timeout(timeout)
            .user_agent(USER_AGENT)
            .build()
            .map_err(|e| GrimoireError::HttpRequest(e.to_string()))?;
        Ok(Self {
            client,
            config: Arc::new(config),
        })
    }

    /// run the scraper synchronously and return the dataset items.
    /// each item maps to one input `query`; missing albums show up as
    /// records with mostly-empty fields.
    pub async fn scrape(
        &self,
        input: &AllMusicScraperInput,
    ) -> GrimoireResponse<Vec<AllMusicAlbum>> {
        info!(
            "allmusic scrape queries={} max_items={:?}",
            input.queries.len(),
            input.max_items
        );

        let actor_id = self.config.actor_id.as_deref().unwrap_or(DEFAULT_ACTOR_ID);
        let url = format!(
            "{}/acts/{}/run-sync-get-dataset-items?token={}",
            APIFY_BASE, actor_id, self.config.api_token
        );

        let resp = match self
            .client
            .post(&url)
            .json(input)
            .send()
            .await
            .map_err(|e| GrimoireError::HttpRequest(e.to_string()))
        {
            Ok(r) => r,
            Err(e) => {
                return GrimoireResponse::failure("allmusic scrape: http error", vec![e.into()]);
            }
        };

        let status = resp.status();
        let body = match resp.text().await {
            Ok(t) => t,
            Err(e) => {
                return GrimoireResponse::failure(
                    "allmusic scrape: read body failed",
                    vec![GrimoireError::HttpRequest(e.to_string()).into()],
                );
            }
        };

        if !status.is_success() {
            warn!("allmusic apify http {}: {}", status, body);
            return GrimoireResponse::failure(
                "allmusic scrape: non-2xx",
                vec![GrimoireError::ProcessingFailed {
                    message: format!("apify http {}: {}", status, body),
                }
                .into()],
            );
        }

        match serde_json::from_str::<Vec<AllMusicAlbum>>(&body) {
            Ok(items) => GrimoireResponse::success("allmusic scrape ok", items),
            Err(e) => GrimoireResponse::failure(
                "allmusic scrape: parse failed",
                vec![GrimoireError::ProcessingFailed {
                    message: format!("parse: {} body={}", e, body),
                }
                .into()],
            ),
        }
    }
}
