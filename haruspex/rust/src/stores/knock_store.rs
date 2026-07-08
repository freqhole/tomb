//! the unified knock (access-request) record.
//!
//! this module owns the record shape, dedup rule, and last-decision-wins
//! resolution semantics - the `KnockPolicy` trait and `KnockOutcome` the
//! accept side-effect produces live in `crate::knock`.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::StoreError;
use crate::stores::grant_store::Role;

/// who initiated the knock: a peer knocking on us (`Inbound`) or us knocking
/// on a peer (`Outbound`).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KnockDirection {
    Inbound,
    Outbound,
}

impl KnockDirection {
    pub fn as_str(&self) -> &'static str {
        match self {
            KnockDirection::Inbound => "inbound",
            KnockDirection::Outbound => "outbound",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "inbound" => Some(KnockDirection::Inbound),
            "outbound" => Some(KnockDirection::Outbound),
            _ => None,
        }
    }
}

/// what access is being requested. `PartialEq` backs the dedup check (one
/// active knock per node id + scope); the sqlite store additionally uses a
/// canonical json rendering of this enum as the dedup key.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum KnockScope {
    /// tomb: acceptance creates a user account.
    Account { requested_username: Option<String> },
    /// playlistz: list access, no specific resource.
    Browse,
    /// skein canvas / playlistz doc_access: access to one resource.
    Resource {
        resource_id: String,
        requested_role: Option<Role>,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KnockStatus {
    Pending,
    Accepted,
    Denied,
}

impl KnockStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            KnockStatus::Pending => "pending",
            KnockStatus::Accepted => "accepted",
            KnockStatus::Denied => "denied",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(KnockStatus::Pending),
            "accepted" => Some(KnockStatus::Accepted),
            "denied" => Some(KnockStatus::Denied),
            _ => None,
        }
    }
}

/// one responder's decision on a knock, kept in an append-only log rather
/// than a single mutable status field - ported from skein's real design
/// (read-only research against loam/src/canvas/canvas-doc.ts's
/// `KnockDecision`, not modified). haruspex's own knock store uses the
/// single-responder, last-decision-wins resolution the automerge design
/// spike recommended promoting to production (`docs/automerge-spike.md`);
/// the first-decision-wins variant sketched there for a hypothetical
/// automerge-backed store stays spike-only.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KnockDecision {
    pub by_node_id: String,
    pub outcome: KnockStatus,
    pub granted_role: Option<String>,
    pub at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KnockRecord {
    pub id: Uuid,
    pub node_id: String,
    pub direction: KnockDirection,
    pub scope: KnockScope,
    pub message: String,
    pub status: KnockStatus,
    pub created_at: i64,
    pub processed_at: Option<i64>,
    pub processed_by: Option<String>,
    /// full decision audit trail - see `KnockDecision`.
    pub decisions: Vec<KnockDecision>,
}

#[async_trait]
pub trait KnockStore: Send + Sync {
    /// enforces the dedup rule: one active (pending) knock per node id +
    /// scope. returns `StoreError::Conflict` if one already exists.
    async fn create_knock(
        &self,
        node_id: &str,
        direction: KnockDirection,
        scope: KnockScope,
        message: String,
        created_at: i64,
    ) -> Result<KnockRecord, StoreError>;
    async fn get_knock(&self, knock_id: Uuid) -> Result<Option<KnockRecord>, StoreError>;
    async fn list_pending(&self) -> Result<Vec<KnockRecord>, StoreError>;
    /// all knock records regardless of status, ordered by `created_at` desc.
    async fn list_all(&self) -> Result<Vec<KnockRecord>, StoreError>;
    /// the most recent knock record for `node_id`, regardless of status, or
    /// `None` if this node id has never knocked. supports the one-knock-ever
    /// lookup rule: once a node id has a knock record (in any status), callers
    /// can find and return that record rather than creating a duplicate.
    async fn find_by_node_id(&self, node_id: &str) -> Result<Option<KnockRecord>, StoreError>;
    /// appends a decision to the record's audit log and resolves the
    /// record's status per the store's resolution policy (last-decision-
    /// wins for haruspex's production sqlite store - see `KnockDecision`).
    async fn record_decision(
        &self,
        knock_id: Uuid,
        decision: KnockDecision,
    ) -> Result<KnockRecord, StoreError>;
    /// permanently delete a knock record. frees the node id to knock again
    /// (since the dedup index only covers pending rows, any future knock from
    /// this node id will create a fresh record once the old one is gone).
    async fn delete_knock(&self, knock_id: Uuid) -> Result<(), StoreError>;
}
