//! gossip digest computation + merge logic.
//!
//! the core digest shape carries `pendingKnocks` + `profiles` plus a
//! namespaced `appPayload` section for app-specific extensions (e.g.
//! canvasUpdates, pendingInvites, sharedCanvasIds for canvas-based apps).
//!
//! both functions here are pure - no store or transport dependency - so an
//! app supplies "what i already know" (already-known knock ids, already-
//! cached profile-doc timestamps) and gets back exactly what's new,
//! choosing for itself how to persist the result.

use std::collections::{HashMap, HashSet};

use super::messages::{
    CoreMessage, FriendzMessage, GossipDigestPendingKnock, GossipDigestProfileEntry,
};

/// build a `gossip-digest` message from local state.
pub fn build_gossip_digest(
    pending_knocks: Vec<GossipDigestPendingKnock>,
    profiles: Vec<GossipDigestProfileEntry>,
    app_payload: Option<serde_json::Value>,
) -> FriendzMessage {
    FriendzMessage::Core(CoreMessage::GossipDigest {
        v: 1,
        pending_knocks,
        profiles,
        app_payload,
    })
}

/// the result of merging an inbound gossip digest against local state: what
/// is genuinely new and worth persisting/acting on.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct GossipMergeResult {
    pub new_pending_knocks: Vec<GossipDigestPendingKnock>,
    pub new_or_updated_profiles: Vec<GossipDigestProfileEntry>,
}

/// merge an inbound `gossip-digest` message against what the caller already
/// knows. `known_knock_ids` is every knock id already recorded locally
/// (dedup key); `known_profile_updated_at` maps peer node id to the
/// `updatedAt` timestamp of whatever profile-doc pointer is already cached
/// for them (missing entry = nothing cached yet). returns only what's new,
/// leaving it up to the caller to decide how to persist it (`KnockStore`, a
/// profile cache, ...).
///
/// `updatedAt`/`knockedAt` are ISO 8601 timestamps (matching every other
/// timestamp field in this crate's wire types) - comparing them as strings
/// is valid staleness detection as long as every producer emits the same
/// fixed-width, zero-padded format (`chrono`/`time`'s `Rfc3339` do), which
/// is already assumed everywhere else these fields are used.
pub fn merge_gossip_digest(
    digest: &FriendzMessage,
    known_knock_ids: &HashSet<String>,
    known_profile_updated_at: &HashMap<String, String>,
) -> GossipMergeResult {
    let FriendzMessage::Core(CoreMessage::GossipDigest {
        pending_knocks,
        profiles,
        ..
    }) = digest
    else {
        return GossipMergeResult::default();
    };

    let new_pending_knocks = pending_knocks
        .iter()
        .filter(|k| !known_knock_ids.contains(&k.knock_id))
        .cloned()
        .collect();

    let new_or_updated_profiles = profiles
        .iter()
        .filter(|p| {
            known_profile_updated_at
                .get(&p.peer_node_id)
                .map(|known| p.updated_at.as_str() > known.as_str())
                .unwrap_or(true)
        })
        .cloned()
        .collect();

    GossipMergeResult {
        new_pending_knocks,
        new_or_updated_profiles,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::messages::WireKnockScope;

    fn knock(id: &str) -> GossipDigestPendingKnock {
        GossipDigestPendingKnock {
            knock_id: id.to_string(),
            node_id: "node-stranger".to_string(),
            username: None,
            message: "let me in".to_string(),
            scope: WireKnockScope::Browse,
            knocked_at: "2026-07-07T00:00:00Z".to_string(),
        }
    }

    fn profile(peer: &str, updated_at: &str) -> GossipDigestProfileEntry {
        GossipDigestProfileEntry {
            peer_node_id: peer.to_string(),
            profile_doc_id: "doc-1".to_string(),
            updated_at: updated_at.to_string(),
        }
    }

    #[test]
    fn build_then_merge_round_trips_new_knocks() {
        let digest = build_gossip_digest(vec![knock("knock-1"), knock("knock-2")], vec![], None);

        let known: HashSet<String> = ["knock-1".to_string()].into_iter().collect();
        let result = merge_gossip_digest(&digest, &known, &HashMap::new());

        assert_eq!(result.new_pending_knocks.len(), 1);
        assert_eq!(result.new_pending_knocks[0].knock_id, "knock-2");
    }

    #[test]
    fn profiles_newer_than_cached_are_returned() {
        let digest = build_gossip_digest(
            vec![],
            vec![
                profile("peer-a", "2026-07-07T00:00:00Z"),
                profile("peer-b", "2026-07-01T00:00:00Z"),
            ],
            None,
        );

        let mut known = HashMap::new();
        known.insert("peer-a".to_string(), "2026-01-01T00:00:00Z".to_string());
        known.insert("peer-b".to_string(), "2026-07-02T00:00:00Z".to_string());

        let result = merge_gossip_digest(&digest, &HashSet::new(), &known);

        // peer-a's incoming update is newer than cached -> included.
        // peer-b's incoming update is older than cached -> excluded.
        assert_eq!(result.new_or_updated_profiles.len(), 1);
        assert_eq!(result.new_or_updated_profiles[0].peer_node_id, "peer-a");
    }

    #[test]
    fn a_profile_never_seen_before_is_always_new() {
        let digest = build_gossip_digest(
            vec![],
            vec![profile("peer-c", "2026-07-07T00:00:00Z")],
            None,
        );
        let result = merge_gossip_digest(&digest, &HashSet::new(), &HashMap::new());
        assert_eq!(result.new_or_updated_profiles.len(), 1);
    }

    #[test]
    fn app_payload_survives_build_and_is_ignored_by_merge() {
        let payload = serde_json::json!({ "skein": { "canvasUpdates": [] } });
        let digest = build_gossip_digest(vec![], vec![], Some(payload.clone()));

        match &digest {
            FriendzMessage::Core(CoreMessage::GossipDigest { app_payload, .. }) => {
                assert_eq!(app_payload.as_ref(), Some(&payload));
            }
            _ => panic!("expected GossipDigest"),
        }

        // merge only looks at pendingKnocks/profiles - app_payload doesn't
        // affect the result.
        let result = merge_gossip_digest(&digest, &HashSet::new(), &HashMap::new());
        assert_eq!(result, GossipMergeResult::default());
    }

    #[test]
    fn merging_a_non_digest_message_returns_an_empty_result() {
        let not_a_digest = FriendzMessage::Core(CoreMessage::ProfileRequest { v: 1 });
        let result = merge_gossip_digest(&not_a_digest, &HashSet::new(), &HashMap::new());
        assert_eq!(result, GossipMergeResult::default());
    }
}
