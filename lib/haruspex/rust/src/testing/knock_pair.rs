//! [`knock_pair`] - two knock stores wired over an in-memory duplex channel
//! simulating the transport, with scripted grant/deny outcomes.
//!
//! per PHASE_4_HARUSPEX_RUST.md: "this does not exist anywhere today - the
//! flows are entangled in each app's service layer - and is the single most
//! valuable test double for consumers". each [`KnockPeer`] pairs a real
//! `SqliteKnockStore` with one end of a `tokio::io::duplex` pair, and moves
//! the exact wire messages `protocol::messages` defines for knocks
//! (`knock-request`/`knock-outcome`) across it via `protocol::codec` - so a
//! test exercises the real wire shapes, not a shortcut struct. no iroh, no
//! `FriendzService` (dispatch deliberately holds no store handles - see that
//! module's doc comment - so knock business logic was never going to live
//! there); this harness is the store-aware layer a real app would put in
//! front of `dispatch`.

use std::collections::HashMap;

use uuid::Uuid;

use crate::protocol::codec::{read_message, write_message, CodecError};
use crate::protocol::messages::{CoreMessage, FriendzMessage, WireKnockScope};
use crate::sqlite::SqliteKnockStore;
use crate::stores::grant_store::Role;
use crate::stores::knock_store::{
    KnockDecision, KnockDirection, KnockRecord, KnockScope, KnockStatus,
};
use crate::stores::KnockStore;

use super::open_in_memory;

#[derive(Debug, thiserror::Error)]
pub enum KnockExchangeError {
    #[error(transparent)]
    Store(#[from] crate::error::StoreError),
    #[error(transparent)]
    Codec(#[from] CodecError),
    #[error("unexpected message: expected {expected}, got {got}")]
    UnexpectedMessage { expected: &'static str, got: String },
    #[error("malformed knock id on the wire: {0}")]
    MalformedKnockId(String),
}

/// one side of a [`knock_pair`] exchange: a real `SqliteKnockStore` plus one
/// end of the in-memory duplex channel standing in for a transport.
///
/// the requester picks a knock id and it travels on the wire as the single
/// canonical id for the whole exchange - but the responder's own
/// `SqliteKnockStore::create_knock` always assigns its own fresh id (the
/// production store has no "use this id" constructor; nothing else needs
/// one). `wire_ids` bridges that gap purely at the harness level: it maps
/// the wire-carried knock id back to whatever local id the responder's
/// store actually assigned, so [`KnockPeer::decide`] can operate on the
/// responder's own store while still emitting the requester's original id
/// on the wire. the requester side never needs a translation (it authored
/// the id itself, so wire id == local id there).
pub struct KnockPeer {
    pub node_id: String,
    pub store: SqliteKnockStore,
    stream: tokio::io::DuplexStream,
    wire_ids: HashMap<Uuid, Uuid>,
}

impl KnockPeer {
    /// send a knock-request to the peer at the other end of the channel,
    /// recording it locally as an outbound pending knock.
    pub async fn send_knock(
        &mut self,
        scope: KnockScope,
        message: impl Into<String>,
        now: i64,
    ) -> Result<KnockRecord, KnockExchangeError> {
        let message = message.into();
        let record = self
            .store
            .create_knock(
                &self.node_id,
                KnockDirection::Outbound,
                scope.clone(),
                message.clone(),
                now,
                None,
            )
            .await?;

        let msg = FriendzMessage::Core(CoreMessage::KnockRequest {
            v: 1,
            knock_id: record.id.to_string(),
            node_id: self.node_id.clone(),
            username: None,
            message,
            scope: WireKnockScope::from_store(scope),
        });
        write_message(&mut self.stream, &msg).await?;
        Ok(record)
    }

    /// block until a knock-request arrives, recording it locally as an
    /// inbound pending knock. the returned record's `id` is the *wire* id
    /// (matching what the sender is tracking as `sent.id`) - internally the
    /// responder's own store may have assigned a different id, tracked via
    /// `wire_ids` so [`Self::decide`] can still find the right local row.
    pub async fn recv_knock(&mut self, now: i64) -> Result<KnockRecord, KnockExchangeError> {
        let msg = read_message(&mut self.stream).await?;
        let FriendzMessage::Core(CoreMessage::KnockRequest {
            knock_id,
            node_id,
            message,
            scope,
            ..
        }) = msg
        else {
            return Err(KnockExchangeError::UnexpectedMessage {
                expected: "knock-request",
                got: format!("{msg:?}"),
            });
        };
        let wire_id = Uuid::parse_str(&knock_id)
            .map_err(|e| KnockExchangeError::MalformedKnockId(e.to_string()))?;

        let mut local_record = self
            .store
            .create_knock(
                &node_id,
                KnockDirection::Inbound,
                scope.to_store(),
                message,
                now,
                None,
            )
            .await?;
        self.wire_ids.insert(wire_id, local_record.id);
        local_record.id = wire_id;
        Ok(local_record)
    }

    /// record a scripted decision locally and send the resulting outcome
    /// back over the channel - the "scripted grant/deny outcomes" half of
    /// the harness. a test drives this directly (no `KnockPolicy` required)
    /// so it stays a thin transport double, not an opinionated business
    /// policy. `knock_id` is the *wire* id (what [`Self::recv_knock`]
    /// returned); translated to the responder's own local store id via
    /// `wire_ids` before touching the store, but the outgoing message still
    /// carries the wire id so the original requester can correlate it.
    pub async fn decide(
        &mut self,
        knock_id: Uuid,
        outcome: KnockStatus,
        granted_role: Option<Role>,
        now: i64,
    ) -> Result<KnockRecord, KnockExchangeError> {
        let local_id = self.wire_ids.get(&knock_id).copied().unwrap_or(knock_id);
        let decision = KnockDecision {
            by_node_id: self.node_id.clone(),
            outcome,
            granted_role: granted_role.map(|r| r.as_str().to_string()),
            at: now,
        };
        let mut record = self.store.record_decision(local_id, decision).await?;
        record.id = knock_id;

        let msg = FriendzMessage::Core(CoreMessage::KnockOutcome {
            v: 1,
            knock_id: Some(knock_id.to_string()),
            status: outcome,
            granted_role,
            granted_resource_ids: Vec::new(),
            by_node_id: Some(self.node_id.clone()),
        });
        write_message(&mut self.stream, &msg).await?;
        Ok(record)
    }

    /// block until a knock-outcome arrives and apply it to the local record
    /// (looked up by the wire message's own `knock_id`, which must match
    /// `expected_knock_id` - a defensive check against a harness misuse
    /// where two overlapping exchanges share one channel).
    pub async fn recv_outcome(
        &mut self,
        expected_knock_id: Uuid,
        now: i64,
    ) -> Result<KnockRecord, KnockExchangeError> {
        let msg = read_message(&mut self.stream).await?;
        let FriendzMessage::Core(CoreMessage::KnockOutcome {
            knock_id,
            status,
            granted_role,
            by_node_id,
            ..
        }) = msg
        else {
            return Err(KnockExchangeError::UnexpectedMessage {
                expected: "knock-outcome",
                got: format!("{msg:?}"),
            });
        };

        let knock_id = match knock_id {
            Some(id) => Uuid::parse_str(&id)
                .map_err(|e| KnockExchangeError::MalformedKnockId(e.to_string()))?,
            None => expected_knock_id,
        };
        if knock_id != expected_knock_id {
            return Err(KnockExchangeError::MalformedKnockId(format!(
                "expected knock id {expected_knock_id}, wire message carried {knock_id}"
            )));
        }

        let local_id = self.wire_ids.get(&knock_id).copied().unwrap_or(knock_id);
        let decision = KnockDecision {
            by_node_id: by_node_id.unwrap_or_default(),
            outcome: status,
            granted_role: granted_role.map(|r| r.as_str().to_string()),
            at: now,
        };
        let mut record = self.store.record_decision(local_id, decision).await?;
        record.id = knock_id;
        Ok(record)
    }
}

/// two [`KnockPeer`]s wired over an in-memory duplex channel: `a`'s writes
/// arrive at `b`'s reads and vice versa, exactly as if they were opposite
/// ends of a real bidirectional stream.
pub struct KnockPair {
    pub a: KnockPeer,
    pub b: KnockPeer,
}

pub async fn knock_pair() -> KnockPair {
    let (stream_a, stream_b) = tokio::io::duplex(64 * 1024);
    KnockPair {
        a: KnockPeer {
            node_id: "peer-a".to_string(),
            store: SqliteKnockStore::new(open_in_memory().await),
            stream: stream_a,
            wire_ids: HashMap::new(),
        },
        b: KnockPeer {
            node_id: "peer-b".to_string(),
            store: SqliteKnockStore::new(open_in_memory().await),
            stream: stream_b,
            wire_ids: HashMap::new(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn full_exchange_accept_grants_a_role() {
        let KnockPair { mut a, mut b } = knock_pair().await;

        let sent = a
            .send_knock(
                KnockScope::Resource {
                    resource_id: "doc-1".to_string(),
                    requested_role: Some(Role::Member),
                },
                "let me in",
                100,
            )
            .await
            .unwrap();
        assert_eq!(sent.status, KnockStatus::Pending);

        let received = b.recv_knock(101).await.unwrap();
        assert_eq!(received.id, sent.id);
        assert_eq!(received.node_id, "peer-a");
        assert_eq!(received.direction, KnockDirection::Inbound);

        let decided = b
            .decide(received.id, KnockStatus::Accepted, Some(Role::Member), 102)
            .await
            .unwrap();
        assert_eq!(decided.status, KnockStatus::Accepted);

        let outcome = a.recv_outcome(sent.id, 103).await.unwrap();
        assert_eq!(outcome.status, KnockStatus::Accepted);
        assert_eq!(outcome.id, sent.id);
    }

    #[tokio::test]
    async fn full_exchange_deny_leaves_no_grant_signal() {
        let KnockPair { mut a, mut b } = knock_pair().await;

        let sent = a
            .send_knock(KnockScope::Browse, "let me browse", 100)
            .await
            .unwrap();
        let received = b.recv_knock(101).await.unwrap();

        b.decide(received.id, KnockStatus::Denied, None, 102)
            .await
            .unwrap();
        let outcome = a.recv_outcome(sent.id, 103).await.unwrap();

        assert_eq!(outcome.status, KnockStatus::Denied);
        assert!(outcome.decisions.last().unwrap().granted_role.is_none());
    }

    #[tokio::test]
    async fn each_peer_has_its_own_independent_store() {
        let KnockPair { a, b } = knock_pair().await;
        assert!(a.store.list_pending().await.unwrap().is_empty());
        assert!(b.store.list_pending().await.unwrap().is_empty());
    }
}
