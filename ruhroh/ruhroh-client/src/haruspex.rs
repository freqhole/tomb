//! Client for communicating with haruspex (Supabase) coordination service

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

/// Haruspex client for Supabase coordination
pub struct HaruspexClient {
    /// Supabase project URL (e.g., http://127.0.0.1:54321)
    base_url: String,
    /// Supabase anon/publishable key
    anon_key: String,
    /// User's access token (JWT) after auth
    access_token: Option<String>,
    /// HTTP client
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

    /// Get authorization header value
    fn auth_header(&self) -> String {
        if let Some(token) = &self.access_token {
            format!("Bearer {}", token)
        } else {
            format!("Bearer {}", self.anon_key)
        }
    }

    /// Sign in with email and password
    pub async fn sign_in(&self, email: &str, password: &str) -> Result<AuthSession> {
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
            .context("failed to sign in")?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("sign in failed: {}", text);
        }

        let session: AuthSession = resp.json().await?;
        Ok(session)
    }

    /// Sign up with email (sends magic link)
    pub async fn sign_up_email(&self, email: &str) -> Result<()> {
        let resp = self
            .client
            .post(format!("{}/auth/v1/magiclink", self.base_url))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "email": email
            }))
            .send()
            .await
            .context("failed to send magic link")?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("magic link failed: {}", text);
        }

        Ok(())
    }

    /// Verify OTP/magic link token and get session
    pub async fn verify_otp(&self, email: &str, token: &str) -> Result<AuthSession> {
        let resp = self
            .client
            .post(format!("{}/auth/v1/verify", self.base_url))
            .header("apikey", &self.anon_key)
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "email": email,
                "token": token,
                "type": "magiclink"
            }))
            .send()
            .await
            .context("failed to verify OTP")?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("OTP verification failed: {}", text);
        }

        let session: AuthSession = resp.json().await?;
        Ok(session)
    }

    /// Get current user profile
    pub async fn get_profile(&self) -> Result<Profile> {
        let resp = self
            .client
            .get(format!("{}/rest/v1/profiles?select=*", self.base_url))
            .header("apikey", &self.anon_key)
            .header("Authorization", self.auth_header())
            .header("Accept", "application/json")
            .send()
            .await?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("failed to get profile: {}", text);
        }

        let profiles: Vec<Profile> = resp.json().await?;
        profiles.into_iter().next().context("no profile found")
    }

    /// Update user profile
    pub async fn update_profile(&self, display_name: &str) -> Result<()> {
        let user_id = self.get_user_id().await?;

        let resp = self
            .client
            .patch(format!(
                "{}/rest/v1/profiles?id=eq.{}",
                self.base_url, user_id
            ))
            .header("apikey", &self.anon_key)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "display_name": display_name
            }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("failed to update profile: {}", text);
        }

        Ok(())
    }

    /// Get user ID from current token
    async fn get_user_id(&self) -> Result<String> {
        let token = self.access_token.as_ref().context("not authenticated")?;

        let resp = self
            .client
            .get(format!("{}/auth/v1/user", self.base_url))
            .header("apikey", &self.anon_key)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await?;

        if !resp.status().is_success() {
            anyhow::bail!("failed to get user");
        }

        let user: serde_json::Value = resp.json().await?;
        user["id"]
            .as_str()
            .map(String::from)
            .context("no user id")
    }

    /// List groups the user is a member of
    pub async fn list_groups(&self) -> Result<Vec<GroupInfo>> {
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
            .await?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("failed to list groups: {}", text);
        }

        Ok(resp.json().await?)
    }

    /// Get all members of a group with their profile info
    pub async fn get_group_members(&self, group_id: &str) -> Result<Vec<GroupMember>> {
        let resp = self
            .client
            .get(format!(
                "{}/rest/v1/group_members?group_id=eq.{}&select=user_id,role,profiles(id,display_name,avatar_url,email:id)",
                self.base_url, group_id
            ))
            .header("apikey", &self.anon_key)
            .header("Authorization", self.auth_header())
            .header("Accept", "application/json")
            .send()
            .await?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("failed to get group members: {}", text);
        }

        // parse the nested response
        let raw: Vec<serde_json::Value> = resp.json().await?;
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

    /// Create a new group
    pub async fn create_group(&self, name: &str, description: Option<&str>) -> Result<GroupInfo> {
        let user_id = self.get_user_id().await?;

        let mut body = serde_json::json!({
            "name": name,
            "created_by": user_id
        });
        if let Some(desc) = description {
            body["description"] = serde_json::Value::String(desc.to_string());
        }

        let resp = self
            .client
            .post(format!("{}/rest/v1/groups", self.base_url))
            .header("apikey", &self.anon_key)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .header("Prefer", "return=representation")
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("failed to create group: {}", text);
        }

        let groups: Vec<GroupInfo> = resp.json().await?;
        groups.into_iter().next().context("no group returned")
    }

    /// Join a group using invite code
    pub async fn join_group_by_invite(&self, invite_code: &str) -> Result<String> {
        let resp = self
            .client
            .post(format!("{}/rest/v1/rpc/join_group_by_invite", self.base_url))
            .header("apikey", &self.anon_key)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "code": invite_code
            }))
            .send()
            .await?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("failed to join group: {}", text);
        }

        // returns the group_id
        let group_id: String = resp.json().await?;
        Ok(group_id)
    }

    /// Update peer presence (heartbeat)
    pub async fn update_peer_presence(
        &self,
        node_id: &str,
        group_id: &str,
        relay_url: Option<&str>,
        instance_name: Option<&str>,
    ) -> Result<String> {
        let mut body = serde_json::json!({
            "p_node_id": node_id,
            "p_group_id": group_id
        });
        if let Some(relay) = relay_url {
            body["p_relay_url"] = serde_json::Value::String(relay.to_string());
        }
        if let Some(name) = instance_name {
            body["p_instance_name"] = serde_json::Value::String(name.to_string());
        }

        let resp = self
            .client
            .post(format!(
                "{}/rest/v1/rpc/update_peer_presence",
                self.base_url
            ))
            .header("apikey", &self.anon_key)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("failed to update peer presence: {}", text);
        }

        let peer_id: String = resp.json().await?;
        Ok(peer_id)
    }

    /// Get online peers in user's groups
    pub async fn get_online_peers(&self, stale_minutes: Option<i32>) -> Result<Vec<PeerInfo>> {
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
            .await?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("failed to get peers: {}", text);
        }

        Ok(resp.json().await?)
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
pub struct Profile {
    pub id: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub created_at: Option<String>,
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

/// Group member with profile info (for sync)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupMember {
    pub user_id: String,
    pub group_id: String,
    pub role: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
}

// ============================================================================
// Interactive sync
// ============================================================================

use dialoguer::{Input, Password};

/// Result of a haruspex sync operation
#[derive(Debug, Clone)]
pub struct SyncResult {
    /// all members from all groups the user is in
    pub members: Vec<GroupMember>,
    /// peers with node_ids (for P2P connections)
    pub peers: Vec<PeerInfo>,
    /// groups the user is a member of
    pub groups: Vec<GroupInfo>,
}

/// Interactive sync with haruspex - prompts for credentials and returns sync data
pub async fn interactive_sync(supabase_url: &str, anon_key: &str) -> Result<SyncResult> {
    println!("haruspex sync");
    println!("supabase url: {}", supabase_url);
    println!();

    // users must already have an account (created via browser/magic link)
    let email: String = Input::new()
        .with_prompt("email")
        .interact_text()?;

    let password: String = Password::new()
        .with_prompt("password")
        .interact()?;

    let client = HaruspexClient::new(supabase_url, anon_key);

    println!("signing in...");
    let session = client.sign_in(&email, &password).await?;

    println!("authenticated as: {} ({})", email, session.user.id);
    println!();

    // now use the session token for subsequent requests
    let client = HaruspexClient::new(supabase_url, anon_key).with_token(&session.access_token);

    // list groups
    let groups = client.list_groups().await?;
    
    if groups.is_empty() {
        println!("no groups found.");
        println!("manage groups via browser at supabase studio or the haruspex web ui.");
        return Ok(SyncResult {
            members: vec![],
            peers: vec![],
            groups: vec![],
        });
    }

    println!("your groups:");
    for group in &groups {
        println!(
            "  - {} ({})",
            group.name,
            group.description.as_deref().unwrap_or("no description")
        );
    }
    println!();

    // get all members from all groups
    let mut all_members = Vec::new();
    for group in &groups {
        println!("fetching members of {}...", group.name);
        match client.get_group_members(&group.id).await {
            Ok(members) => {
                println!("  {} member(s)", members.len());
                all_members.extend(members);
            }
            Err(e) => {
                println!("  failed to get members: {}", e);
            }
        }
    }
    println!();

    // deduplicate members (a user could be in multiple groups)
    let mut seen_users = std::collections::HashSet::new();
    all_members.retain(|m| seen_users.insert(m.user_id.clone()));

    println!("total unique members: {}", all_members.len());
    for member in &all_members {
        println!(
            "  - {} ({})",
            member.display_name.as_deref().unwrap_or(&member.user_id),
            member.role
        );
    }
    println!();

    // get online peers (for node_id info)
    let peers = client.get_online_peers(Some(60)).await?;
    
    if peers.is_empty() {
        println!("no online peers found (within last 60 minutes).");
    } else {
        println!("online peers with node_ids:");
        for peer in &peers {
            println!(
                "  - {} ({}) in {}",
                peer.display_name.as_deref().unwrap_or("unnamed"),
                peer.node_id,
                peer.group_name.as_deref().unwrap_or("unknown group")
            );
        }
    }
    println!();

    Ok(SyncResult {
        members: all_members,
        peers,
        groups,
    })}