//! friend edges: node-id-scoped relationship state.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::error::StoreError;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FriendStatus {
    Pending,
    Accepted,
    Allowed,
    Blocked,
}

impl FriendStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            FriendStatus::Pending => "pending",
            FriendStatus::Accepted => "accepted",
            FriendStatus::Allowed => "allowed",
            FriendStatus::Blocked => "blocked",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(FriendStatus::Pending),
            "accepted" => Some(FriendStatus::Accepted),
            "allowed" => Some(FriendStatus::Allowed),
            "blocked" => Some(FriendStatus::Blocked),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FriendDirection {
    Outbound,
    Inbound,
}

impl FriendDirection {
    pub fn as_str(&self) -> &'static str {
        match self {
            FriendDirection::Outbound => "outbound",
            FriendDirection::Inbound => "inbound",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "outbound" => Some(FriendDirection::Outbound),
            "inbound" => Some(FriendDirection::Inbound),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FriendEdge {
    pub node_id: String,
    pub status: FriendStatus,
    pub direction: FriendDirection,
    pub alias: Option<String>,
    pub group_name: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[async_trait]
pub trait FriendStore: Send + Sync {
    async fn upsert_edge(&self, edge: FriendEdge) -> Result<FriendEdge, StoreError>;
    async fn get_edge(&self, node_id: &str) -> Result<Option<FriendEdge>, StoreError>;
    async fn list_edges(
        &self,
        status: Option<FriendStatus>,
    ) -> Result<Vec<FriendEdge>, StoreError>;
    async fn remove_edge(&self, node_id: &str) -> Result<(), StoreError>;
}
