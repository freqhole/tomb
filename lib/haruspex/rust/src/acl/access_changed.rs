//! the `on_access_changed` revocation hook.
//!
//! generalizes skein's real `HubRepo::cancel_peer` (read-only research
//! against `reliquary/src/hub_repo.rs`): that code keeps one
//! `tokio_util::sync::CancellationToken` per connected peer id in a
//! `HashMap`, and calling `cancel_peer(peer_id)` looks the token up and
//! calls `.cancel()` on it - today the only live-revocation path in any of
//! the three apps (its doc comment notes friendz-removal alone does not tear
//! down an already-open connection without it).
//!
//! `AccessChangeHub` is the same mechanism keyed on an identity or a group
//! instead of a bare peer id (haruspex's unit of revocation is "this
//! identity's access changed" or "this group's grants changed", not "this
//! transport-level peer id"), and holds a `Vec` of tokens per key rather
//! than one, since a single identity may have several live
//! transports/streams registered at once.
//!
//! # group-level fan-out is the caller's job
//!
//! revoking a `RoleGrant` on a `Subject::Group` changes effective access for
//! every live member of that group, but this hub only cancels tokens
//! registered against the exact key it's given. if transports register
//! against `AccessChangeSubject::Identity` (the common case - a live
//! connection belongs to one resolved identity), the caller revoking a
//! group-level grant is responsible for fanning out: look up
//! `GroupStore::members_of(group_id)` and call `on_access_changed` for each
//! member's `AccessChangeSubject::Identity`, in addition to (or instead of)
//! `AccessChangeSubject::Group(group_id)` itself. this hub does not do that
//! automatically because it has no `GroupStore` handle and doing the lookup
//! here would tie a transport-facing primitive to storage.

use std::collections::HashMap;

use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AccessChangeSubject {
    Identity(Uuid),
    Group(Uuid),
}

#[derive(Default)]
pub struct AccessChangeHub {
    tokens: RwLock<HashMap<AccessChangeSubject, Vec<CancellationToken>>>,
}

impl AccessChangeHub {
    pub fn new() -> Self {
        Self::default()
    }

    /// register a token a transport will cancel its own live
    /// connection/stream with when `on_access_changed` next fires for
    /// `subject`. call this once per live transport, right after it
    /// authenticates as `subject`.
    pub async fn register(&self, subject: AccessChangeSubject, token: CancellationToken) {
        self.tokens
            .write()
            .await
            .entry(subject)
            .or_default()
            .push(token);
    }

    /// call this immediately after revoking a `Membership` or `RoleGrant`
    /// naming `subject` (see module docs for the group fan-out caveat).
    /// cancels every token currently registered against `subject` and
    /// clears the list - transports are expected to re-register on
    /// reconnect. returns the number of tokens cancelled (0 is a normal,
    /// common result: the common case is revoking access for someone with
    /// no live connection at all).
    pub async fn on_access_changed(&self, subject: AccessChangeSubject) -> usize {
        let tokens = self
            .tokens
            .write()
            .await
            .remove(&subject)
            .unwrap_or_default();
        let count = tokens.len();
        for token in tokens {
            token.cancel();
        }
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn on_access_changed_cancels_a_registered_token() {
        let hub = AccessChangeHub::new();
        let identity_id = Uuid::new_v4();
        let token = CancellationToken::new();
        hub.register(AccessChangeSubject::Identity(identity_id), token.clone())
            .await;

        assert!(!token.is_cancelled());
        let cancelled = hub
            .on_access_changed(AccessChangeSubject::Identity(identity_id))
            .await;

        assert_eq!(cancelled, 1);
        assert!(token.is_cancelled());
    }

    #[tokio::test]
    async fn on_access_changed_cancels_every_token_registered_for_the_subject() {
        let hub = AccessChangeHub::new();
        let identity_id = Uuid::new_v4();
        let token_a = CancellationToken::new();
        let token_b = CancellationToken::new();
        hub.register(AccessChangeSubject::Identity(identity_id), token_a.clone())
            .await;
        hub.register(AccessChangeSubject::Identity(identity_id), token_b.clone())
            .await;

        let cancelled = hub
            .on_access_changed(AccessChangeSubject::Identity(identity_id))
            .await;

        assert_eq!(cancelled, 2);
        assert!(token_a.is_cancelled());
        assert!(token_b.is_cancelled());
    }

    #[tokio::test]
    async fn on_access_changed_does_not_touch_a_different_subjects_tokens() {
        let hub = AccessChangeHub::new();
        let identity_a = Uuid::new_v4();
        let identity_b = Uuid::new_v4();
        let token_a = CancellationToken::new();
        let token_b = CancellationToken::new();
        hub.register(AccessChangeSubject::Identity(identity_a), token_a.clone())
            .await;
        hub.register(AccessChangeSubject::Identity(identity_b), token_b.clone())
            .await;

        hub.on_access_changed(AccessChangeSubject::Identity(identity_a))
            .await;

        assert!(token_a.is_cancelled());
        assert!(!token_b.is_cancelled());
    }

    #[tokio::test]
    async fn group_and_identity_keys_are_independent() {
        let hub = AccessChangeHub::new();
        let id = Uuid::new_v4();
        let identity_token = CancellationToken::new();
        let group_token = CancellationToken::new();
        hub.register(AccessChangeSubject::Identity(id), identity_token.clone())
            .await;
        hub.register(AccessChangeSubject::Group(id), group_token.clone())
            .await;

        hub.on_access_changed(AccessChangeSubject::Group(id)).await;

        assert!(!identity_token.is_cancelled());
        assert!(group_token.is_cancelled());
    }

    #[tokio::test]
    async fn on_access_changed_with_no_registered_tokens_is_a_no_op() {
        let hub = AccessChangeHub::new();
        let cancelled = hub
            .on_access_changed(AccessChangeSubject::Identity(Uuid::new_v4()))
            .await;
        assert_eq!(cancelled, 0);
    }

    #[tokio::test]
    async fn firing_twice_only_cancels_newly_registered_tokens_the_second_time() {
        let hub = AccessChangeHub::new();
        let identity_id = Uuid::new_v4();
        let first_token = CancellationToken::new();
        hub.register(
            AccessChangeSubject::Identity(identity_id),
            first_token.clone(),
        )
        .await;
        hub.on_access_changed(AccessChangeSubject::Identity(identity_id))
            .await;

        // simulate the transport reconnecting and re-registering
        let second_token = CancellationToken::new();
        hub.register(
            AccessChangeSubject::Identity(identity_id),
            second_token.clone(),
        )
        .await;

        assert!(first_token.is_cancelled());
        assert!(!second_token.is_cancelled());

        hub.on_access_changed(AccessChangeSubject::Identity(identity_id))
            .await;
        assert!(second_token.is_cancelled());
    }
}
