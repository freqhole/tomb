//! webauthn challenge (nonce) storage - the p2p-friendly replacement for
//! cookie-based challenge sessions.
//!
//! ported from grimoire's real `ChallengeStore` (read-only research against
//! `grimoire/src/users/challenge_store.rs`): http transport can stash a
//! webauthn challenge in a cookie session between the ceremony's start and
//! finish calls, but p2p has no cookie, so the challenge is persisted here
//! instead, keyed by a short-lived nonce the client echoes back on finish.
//! single-use (deleted on read) and ttl-bounded, same as the donor.
//!
//! this store is not behind the `webauthn` feature - it stores an opaque
//! `challenge_json` blob and has no dependency on `webauthn-rs` itself; only
//! `crate::webauthn` (the ceremony handlers that populate/consume that blob)
//! is feature-gated.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::StoreError;

/// which ceremony step a challenge belongs to - checked on `take` so a
/// registration challenge can't be replayed as an authentication one.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChallengeKind {
    Registration,
    Authentication,
    /// discoverable-credential authentication: no username/identity known
    /// until the credential response arrives (see grimoire's
    /// `start_discoverable_authentication`/`identify_discoverable_authentication`).
    DiscoverableAuthentication,
}

impl ChallengeKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ChallengeKind::Registration => "registration",
            ChallengeKind::Authentication => "authentication",
            ChallengeKind::DiscoverableAuthentication => "discoverable_authentication",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "registration" => Some(ChallengeKind::Registration),
            "authentication" => Some(ChallengeKind::Authentication),
            "discoverable_authentication" => Some(ChallengeKind::DiscoverableAuthentication),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Challenge {
    pub nonce: String,
    pub kind: ChallengeKind,
    /// the serialized `PasskeyRegistration`/`PasskeyAuthentication`/
    /// `DiscoverableAuthentication` state (webauthn-rs types) - haruspex
    /// itself never deserializes this; only `crate::webauthn` does.
    pub challenge_json: String,
    pub identity_id: Option<Uuid>,
    pub username: Option<String>,
    /// account-link flow: this registration attaches a new passkey to an
    /// EXISTING identity rather than creating one. see `crate::webauthn`'s
    /// module docs for how this and `invite_code` are used together.
    pub is_account_link: bool,
    /// carried through the nonce round-trip so the ceremony's finish step
    /// can act on it (e.g. mark an invite code redeemed) - haruspex does not
    /// validate or redeem invite codes itself (no `InviteStore` exists yet
    /// in this crate; that store is a separate, later task), it only
    /// preserves this field across the challenge's lifetime.
    pub invite_code: Option<String>,
}

pub struct SaveChallengeArgs {
    pub kind: ChallengeKind,
    pub challenge_json: String,
    pub identity_id: Option<Uuid>,
    pub username: Option<String>,
    pub is_account_link: bool,
    pub invite_code: Option<String>,
    pub created_at: i64,
    pub expires_at: i64,
}

#[async_trait]
pub trait ChallengeStore: Send + Sync {
    /// persists a challenge and returns a freshly generated nonce.
    async fn save(&self, args: SaveChallengeArgs) -> Result<String, StoreError>;

    /// retrieves and atomically deletes the challenge for `nonce` (single
    /// use), provided it matches `expected_kind` and has not expired as of
    /// `now`. returns `None` for a missing, expired, or kind-mismatched
    /// nonce - all three are indistinguishable to the caller on purpose (the
    /// donor's same behavior: don't leak which case occurred).
    async fn take(
        &self,
        nonce: &str,
        expected_kind: ChallengeKind,
        now: i64,
    ) -> Result<Option<Challenge>, StoreError>;
}
