//! Client for communicating with ruhroh-central server

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

pub struct CentralClient {
    base_url: String,
    api_key: Option<String>,
    client: reqwest::Client,
}

impl CentralClient {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key: None,
            client: reqwest::Client::new(),
        }
    }

    pub fn with_auth(mut self, api_key: &str) -> Self {
        self.api_key = Some(api_key.to_string());
        self
    }

    /// Register with central server
    pub async fn register(
        &self,
        invite_code: &str,
        display_name: &str,
        node_id: &str,
        endpoint_addr: &str,
    ) -> Result<(String, String)> {
        let req = RegisterRequest {
            invite_code: invite_code.to_string(),
            display_name: display_name.to_string(),
            node_id: node_id.to_string(),
            endpoint_addr: endpoint_addr.to_string(),
        };

        let resp = self
            .client
            .post(format!("{}/api/register", self.base_url))
            .json(&req)
            .send()
            .await
            .context("failed to connect to central server")?;

        if !resp.status().is_success() {
            let error: ErrorResponse = resp.json().await?;
            anyhow::bail!("registration failed: {}", error.error);
        }

        let data: RegisterResponse = resp.json().await?;
        Ok((data.server_id, data.api_key))
    }

    /// List all groups
    pub async fn list_groups(&self) -> Result<Vec<GroupInfo>> {
        let api_key = self.api_key.as_ref().context("not authenticated")?;

        let resp = self
            .client
            .get(format!("{}/api/groups", self.base_url))
            .bearer_auth(api_key)
            .send()
            .await?;

        if !resp.status().is_success() {
            let error: ErrorResponse = resp.json().await?;
            anyhow::bail!("failed to list groups: {}", error.error);
        }

        Ok(resp.json().await?)
    }

    /// Join a group
    pub async fn join_group(&self, group_id: &str) -> Result<()> {
        let api_key = self.api_key.as_ref().context("not authenticated")?;

        let resp = self
            .client
            .post(format!("{}/api/groups/{}/join", self.base_url, group_id))
            .bearer_auth(api_key)
            .send()
            .await?;

        if !resp.status().is_success() {
            let error: ErrorResponse = resp.json().await?;
            anyhow::bail!("failed to join group: {}", error.error);
        }

        Ok(())
    }

    /// List peers in your groups
    pub async fn list_peers(&self) -> Result<Vec<PeerInfo>> {
        let api_key = self.api_key.as_ref().context("not authenticated")?;

        let resp = self
            .client
            .get(format!("{}/api/peers", self.base_url))
            .bearer_auth(api_key)
            .send()
            .await?;

        if !resp.status().is_success() {
            let error: ErrorResponse = resp.json().await?;
            anyhow::bail!("failed to list peers: {}", error.error);
        }

        Ok(resp.json().await?)
    }
}

#[derive(Serialize)]
struct RegisterRequest {
    invite_code: String,
    display_name: String,
    node_id: String,
    /// Full iroh endpoint address (includes relay info)
    endpoint_addr: String,
}

#[derive(Deserialize)]
struct RegisterResponse {
    server_id: String,
    api_key: String,
}

#[derive(Deserialize)]
pub struct GroupInfo {
    #[serde(alias = "group_id")]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub is_member: bool,
}

#[derive(Deserialize)]
pub struct PeerInfo {
    pub server_id: String,
    pub display_name: String,
    #[serde(alias = "node_id")]
    pub endpoint_id: String,
    /// Full iroh endpoint address for connecting
    #[serde(default)]
    pub endpoint_addr: String,
}

#[derive(Deserialize)]
struct ErrorResponse {
    error: String,
}
