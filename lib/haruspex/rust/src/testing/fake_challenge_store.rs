//! [`FakeChallengeStore`] - a scripted, non-sqlite `ChallengeStore` for
//! tests that don't want to spin up a sqlite pool just to exercise a webauthn
//! ceremony's challenge round trip.
//!
//! same semantics as `sqlite::SqliteChallengeStore` (single-use delete-on-
//! read, ttl-bounded, kind-checked) implemented over a plain in-memory map
//! instead of a table - "no crypto, just a map with ttl" per
//! PHASE_4_HARUSPEX_RUST.md's testing-exports spec.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use async_trait::async_trait;
use tokio::sync::Mutex;

use crate::error::StoreError;
use crate::stores::challenge_store::{Challenge, ChallengeKind, SaveChallengeArgs};
use crate::stores::ChallengeStore;

pub struct FakeChallengeStore {
    challenges: Mutex<HashMap<String, (Challenge, i64)>>,
    next_nonce: AtomicU64,
}

impl Default for FakeChallengeStore {
    fn default() -> Self {
        Self {
            challenges: Mutex::new(HashMap::new()),
            next_nonce: AtomicU64::new(0),
        }
    }
}

impl FakeChallengeStore {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl ChallengeStore for FakeChallengeStore {
    async fn save(&self, args: SaveChallengeArgs) -> Result<String, StoreError> {
        let n = self.next_nonce.fetch_add(1, Ordering::Relaxed);
        let nonce = format!("fake-nonce-{n}");
        let challenge = Challenge {
            nonce: nonce.clone(),
            kind: args.kind,
            challenge_json: args.challenge_json,
            identity_id: args.identity_id,
            username: args.username,
            is_account_link: args.is_account_link,
            invite_code: args.invite_code,
        };
        self.challenges
            .lock()
            .await
            .insert(nonce.clone(), (challenge, args.expires_at));
        Ok(nonce)
    }

    async fn take(
        &self,
        nonce: &str,
        expected_kind: ChallengeKind,
        now: i64,
    ) -> Result<Option<Challenge>, StoreError> {
        let Some((challenge, expires_at)) = self.challenges.lock().await.remove(nonce) else {
            return Ok(None);
        };
        // expired or kind-mismatched are indistinguishable from missing to
        // the caller, same as the sqlite store - see that module's doc
        // comment on `take` for why.
        if expires_at <= now || challenge.kind != expected_kind {
            return Ok(None);
        }
        Ok(Some(challenge))
    }
}

/// a fresh `FakeChallengeStore` with nothing saved yet.
pub fn fake_challenge_store() -> FakeChallengeStore {
    FakeChallengeStore::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(kind: ChallengeKind, expires_at: i64) -> SaveChallengeArgs {
        SaveChallengeArgs {
            kind,
            challenge_json: "{}".to_string(),
            identity_id: None,
            username: Some("alice".to_string()),
            is_account_link: false,
            invite_code: None,
            created_at: 100,
            expires_at,
        }
    }

    #[tokio::test]
    async fn save_then_take_round_trips() {
        let store = fake_challenge_store();
        let nonce = store
            .save(args(ChallengeKind::Registration, 1000))
            .await
            .unwrap();

        let taken = store
            .take(&nonce, ChallengeKind::Registration, 500)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(taken.username.as_deref(), Some("alice"));
    }

    #[tokio::test]
    async fn take_is_single_use() {
        let store = fake_challenge_store();
        let nonce = store
            .save(args(ChallengeKind::Registration, 1000))
            .await
            .unwrap();

        store
            .take(&nonce, ChallengeKind::Registration, 500)
            .await
            .unwrap();
        assert!(store
            .take(&nonce, ChallengeKind::Registration, 500)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn take_after_expiry_returns_none() {
        let store = fake_challenge_store();
        let nonce = store
            .save(args(ChallengeKind::Registration, 1000))
            .await
            .unwrap();

        assert!(store
            .take(&nonce, ChallengeKind::Registration, 1000)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn take_with_wrong_kind_returns_none() {
        let store = fake_challenge_store();
        let nonce = store
            .save(args(ChallengeKind::Registration, 1000))
            .await
            .unwrap();

        assert!(store
            .take(&nonce, ChallengeKind::Authentication, 500)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn take_unknown_nonce_returns_none() {
        let store = fake_challenge_store();
        assert!(store
            .take("unknown", ChallengeKind::Registration, 500)
            .await
            .unwrap()
            .is_none());
    }
}
