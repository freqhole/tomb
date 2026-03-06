//! haruspex (Supabase) REST client for federation coordination
//!
//! minimal client for interacting with haruspex - handles authentication,
//! group membership queries, and peer discovery.

use crate::error::{GrimoireError, GrimoireResult};
use serde::{Deserialize, Serialize};

/// haruspex client for Supabase coordination
pub struct HaruspexClient {
    base_url: String,
    anon_key: String,
    access_token: Option<String>,
    client: reqwest::Client,
}

impl HaruspexClient {
    pub fn new(base_url: &str, anon_key: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            anon_key: anon_key.to_string(),
            access_token: None,
            client: reqwest::Client::new(),
        }
    }

    pub fn with_token(mut self, token: &str) -> Self {
        self.access_token = Some(token.to_string());
        self
    }

    fn auth_header(&self) -> String {
        if let Some(token) = &self.access_token {
            format!("Bearer {}", token)
        } else {
            format!("Bearer {}", self.anon_key)
        }
    }

    /// sign in with email and password
    pub async fn sign_in(&self, email: &str, password: &str) -> GrimoireResult<AuthSession> {
        let resp = self
            .client
            .post(format!(
                "{}/auth/v1/token?grant_type=password",
                self.base_url
            ))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "email": email,
                "password": password
            }))
            .send()
            .await
            .map_err(|e| GrimoireError::FederationAuthFailed {
                message: e.to_string(),
            })?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(GrimoireError::FederationAuthFailed { message: text });
        }

        resp.json()
            .await
            .map_err(|e| GrimoireError::FederationAuthFailed {
                message: format!("failed to parse auth response: {}", e),
            })
    }

    /// list groups the user is a member of
    pub async fn list_groups(&self) -> GrimoireResult<Vec<GroupInfo>> {
        let resp = self
            .client
            .get(format!(
                "{}/rest/v1/groups?select=id,name,description,invite_code,created_at",
                self.base_url
            ))
            .header("apikey", &self.anon_key)
            .header("Authorization", self.auth_header())
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to list groups: {}", e),
            })?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(GrimoireError::FederationApiError {
                message: format!("failed to list groups: {}", text),
            });
        }

        resp.json()
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to parse groups response: {}", e),
            })
    }

    /// get all members of a group with their profile info
    pub async fn get_group_members(&self, group_id: &str) -> GrimoireResult<Vec<GroupMember>> {
        let resp = self
            .client
            .get(format!(
                "{}/rest/v1/group_members?group_id=eq.{}&select=user_id,role,profiles(id,display_name,avatar_url)",
                self.base_url, group_id
            ))
            .header("apikey", &self.anon_key)
            .header("Authorization", self.auth_header())
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to get group members: {}", e),
            })?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(GrimoireError::FederationApiError {
                message: format!("failed to get group members: {}", text),
            });
        }

        // parse the nested response
        let raw: Vec<serde_json::Value> =
            resp.json()
                .await
                .map_err(|e| GrimoireError::FederationApiError {
                    message: format!("failed to parse group members response: {}", e),
                })?;

        let mut members = Vec::new();

        for item in raw {
            let user_id = item["user_id"].as_str().unwrap_or_default().to_string();
            let role = item["role"].as_str().unwrap_or("member").to_string();
            let profile = &item["profiles"];

            members.push(GroupMember {
                user_id: user_id.clone(),
                group_id: group_id.to_string(),
                role,
                display_name: profile["display_name"].as_str().map(String::from),
                avatar_url: profile["avatar_url"].as_str().map(String::from),
            });
        }

        Ok(members)
    }

    /// get online peers in user's groups (includes node_ids for P2P)
    pub async fn get_online_peers(
        &self,
        stale_minutes: Option<i32>,
    ) -> GrimoireResult<Vec<PeerInfo>> {
        let minutes = stale_minutes.unwrap_or(5);

        let resp = self
            .client
            .post(format!("{}/rest/v1/rpc/get_online_peers", self.base_url))
            .header("apikey", &self.anon_key)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "stale_minutes": minutes
            }))
            .send()
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to get peers: {}", e),
            })?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(GrimoireError::FederationApiError {
                message: format!("failed to get peers: {}", text),
            });
        }

        resp.json()
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to parse peers response: {}", e),
            })
    }

    /// refresh access token using a refresh token
    pub async fn refresh_token(&self, refresh_token: &str) -> GrimoireResult<AuthSession> {
        let resp = self
            .client
            .post(format!(
                "{}/auth/v1/token?grant_type=refresh_token",
                self.base_url
            ))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "refresh_token": refresh_token
            }))
            .send()
            .await
            .map_err(|e| GrimoireError::FederationTokenRefreshFailed {
                message: e.to_string(),
            })?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(GrimoireError::FederationTokenRefreshFailed { message: text });
        }

        resp.json()
            .await
            .map_err(|e| GrimoireError::FederationTokenRefreshFailed {
                message: format!("failed to parse refresh response: {}", e),
            })
    }

    /// register or update peer presence in haruspex
    ///
    /// this registers the freqhole instance's node_id with a specific group.
    /// uses update_peer_presence which does an upsert.
    pub async fn register_peer(
        &self,
        node_id: &str,
        group_id: &str,
        relay_url: Option<&str>,
        instance_name: Option<&str>,
    ) -> GrimoireResult<String> {
        let resp = self
            .client
            .post(format!(
                "{}/rest/v1/rpc/update_peer_presence",
                self.base_url
            ))
            .header("apikey", &self.anon_key)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "p_node_id": node_id,
                "p_group_id": group_id,
                "p_relay_url": relay_url,
                "p_instance_name": instance_name
            }))
            .send()
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to register peer: {}", e),
            })?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(GrimoireError::FederationApiError {
                message: format!("failed to register peer: {}", text),
            });
        }

        // returns the peer_id (uuid)
        resp.json()
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to parse register peer response: {}", e),
            })
    }

    /// lookup user by node_id
    ///
    /// returns user info only if the node_id owner is in a shared group with the caller.
    /// used for on-the-fly user creation when a peer connects via P2P.
    pub async fn get_user_by_node_id(
        &self,
        node_id: &str,
    ) -> GrimoireResult<Option<NodeIdUserInfo>> {
        let resp = self
            .client
            .post(format!("{}/rest/v1/rpc/get_user_by_node_id", self.base_url))
            .header("apikey", &self.anon_key)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "p_node_id": node_id
            }))
            .send()
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to lookup user by node_id: {}", e),
            })?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(GrimoireError::FederationApiError {
                message: format!("failed to lookup user by node_id: {}", text),
            });
        }

        // returns array of results (should be 0 or 1)
        let results: Vec<NodeIdUserInfo> =
            resp.json()
                .await
                .map_err(|e| GrimoireError::FederationApiError {
                    message: format!("failed to parse node_id lookup response: {}", e),
                })?;

        Ok(results.into_iter().next())
    }
}

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSession {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub token_type: String,
    pub user: AuthUser,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthUser {
    pub id: String,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub invite_code: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupMember {
    pub user_id: String,
    pub group_id: String,
    pub role: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerInfo {
    pub peer_id: String,
    pub user_id: String,
    pub group_id: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub node_id: String,
    pub relay_url: Option<String>,
    pub instance_name: Option<String>,
    pub last_seen: Option<String>,
    pub group_name: Option<String>,
}

/// user info returned from node_id lookup
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeIdUserInfo {
    pub user_id: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub node_id: String,
    pub group_id: String,
    pub group_name: Option<String>,
}
