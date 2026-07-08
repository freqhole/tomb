//! invite codes for the knock-free onboarding path (from tomb's real
//! `invite_codez`/`InviteCode`): a code that grants a role on redemption,
//! either for a brand-new identity (`InviteCodeType::Invite`) or to link a
//! new device onto an existing identity (`InviteCodeType::AccountLink`).
//!
//! ported from tomb's `InviteCode`/`CreateInviteCodeRequest`/
//! `UserService::generate_invite_codes` (read-only research against
//! `grimoire/src/users/models.rs` and `grimoire/src/users/service.rs`).
//! `generate_invite_codes`'s admin-only / no-root-grant / target-user-exists
//! checks are app-level authorization policy (they inspect a `requesting_user`
//! and call back into the same service for a `link_for_user_id` lookup) and
//! stay out of this store on purpose - the store is crud plus the
//! validity/expiry predicates (`InviteCode::is_valid_for_use`); an app wires
//! its own admin gate (via `crate::acl::Caller::is_admin`) in front of
//! `create_invite` the same way it wires one in front of any other admin
//! action.
//!
//! a word-based code generator (drawing memorable words from a wordlist
//! asset) is deliberately not included here - this crate does not ship a
//! wordlist asset. `generate_invite_code` in this module produces a code
//! from random bytes instead (see its doc comment for the exact shape); an
//! app with its own wordlist asset is free to generate its own code string
//! and pass it to `create_invite` - this store's trait only persists
//! whatever code string it's given, it never generates one itself.

use async_trait::async_trait;
use rand::Rng;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::StoreError;
use crate::stores::grant_store::Role;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum InviteCodeType {
    /// a regular invite: redeeming it creates a brand-new identity.
    #[default]
    Invite,
    /// redeeming it links a new device onto an existing identity
    /// (`link_for_user_id`) rather than creating one.
    AccountLink,
}

impl InviteCodeType {
    pub fn as_str(&self) -> &'static str {
        match self {
            InviteCodeType::Invite => "invite",
            InviteCodeType::AccountLink => "account-link",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "invite" => Some(InviteCodeType::Invite),
            "account-link" => Some(InviteCodeType::AccountLink),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InviteCode {
    pub id: Uuid,
    pub code: String,
    pub code_type: InviteCodeType,
    /// role granted to whoever redeems this code. meaningless for
    /// `AccountLink` codes (redeeming one links a device onto
    /// `link_for_user_id`'s existing role rather than granting a fresh one)
    /// but still stored.
    pub grants_role: Role,
    /// set only for `AccountLink` codes: the identity this code links a new
    /// device onto.
    pub link_for_user_id: Option<Uuid>,
    /// expiry for `AccountLink` codes (tomb's self-service link flow expires
    /// these in one hour). `None` for regular invites, which don't expire on
    /// their own - `deactivate` is how an admin retires one early.
    pub link_expires_at: Option<i64>,
    pub created_at: i64,
    pub used_at: Option<i64>,
    pub used_by: Option<Uuid>,
    pub is_active: bool,
}

impl InviteCode {
    pub fn is_account_link(&self) -> bool {
        self.code_type == InviteCodeType::AccountLink
    }

    pub fn is_expired(&self, now: i64) -> bool {
        self.link_expires_at
            .is_some_and(|expires_at| now > expires_at)
    }

    /// active, unused, and not expired - the redeem-time check every
    /// `InviteStore` consumer runs before accepting a code.
    pub fn is_valid_for_use(&self, now: i64) -> bool {
        self.is_active && self.used_at.is_none() && !self.is_expired(now)
    }
}

/// invite-code crud. authorization (who may create a code, whether the
/// requested role/target user is allowed) is an app-level concern layered on
/// top - see this module's doc comment.
#[async_trait]
pub trait InviteStore: Send + Sync {
    async fn create_invite(&self, invite: InviteCode) -> Result<InviteCode, StoreError>;
    async fn find_by_code(&self, code: &str) -> Result<Option<InviteCode>, StoreError>;
    /// mark a code as used. callers are expected to have already checked
    /// `InviteCode::is_valid_for_use`; this just stamps `used_at`/`used_by`.
    async fn mark_used(
        &self,
        code: &str,
        used_by: Uuid,
        used_at: i64,
    ) -> Result<InviteCode, StoreError>;
    /// deactivate a code so it can no longer be redeemed, even if unused.
    async fn deactivate(&self, code: &str) -> Result<(), StoreError>;
    async fn list_active(&self) -> Result<Vec<InviteCode>, StoreError>;
}

/// generate a random invite code: four groups of four uppercase
/// alphanumeric characters (drawn from an ambiguity-reduced alphabet - no
/// `0`/`O`/`1`/`I`), hyphen-separated, e.g. `"7K4M-QRT9-2XCV-8FHN"`. this
/// crate has no wordlist asset to draw memorable words from (see module
/// docs), so a fixed alphabet stands in for it.
pub fn generate_invite_code() -> String {
    const ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let mut rng = rand::thread_rng();
    (0..4)
        .map(|_| {
            (0..4)
                .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("-")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code(overrides: impl FnOnce(InviteCode) -> InviteCode) -> InviteCode {
        overrides(InviteCode {
            id: Uuid::new_v4(),
            code: "AAAA-BBBB-CCCC-DDDD".to_string(),
            code_type: InviteCodeType::Invite,
            grants_role: Role::Member,
            link_for_user_id: None,
            link_expires_at: None,
            created_at: 100,
            used_at: None,
            used_by: None,
            is_active: true,
        })
    }

    #[test]
    fn generate_invite_code_has_the_expected_shape() {
        let generated = generate_invite_code();
        let parts: Vec<&str> = generated.split('-').collect();
        assert_eq!(parts.len(), 4);
        for part in parts {
            assert_eq!(part.len(), 4);
            assert!(part
                .chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()));
            assert!(!part.contains(['0', 'O', '1', 'I']));
        }
    }

    #[test]
    fn generate_invite_code_is_not_trivially_repeated() {
        // not a statistical proof, just a smoke check that we aren't
        // returning a constant string.
        let a = generate_invite_code();
        let b = generate_invite_code();
        assert_ne!(a, b);
    }

    #[test]
    fn fresh_invite_is_valid_for_use() {
        let c = code(|c| c);
        assert!(c.is_valid_for_use(1000));
    }

    #[test]
    fn used_invite_is_not_valid_for_use() {
        let c = code(|c| InviteCode {
            used_at: Some(500),
            used_by: Some(Uuid::new_v4()),
            ..c
        });
        assert!(!c.is_valid_for_use(1000));
    }

    #[test]
    fn deactivated_invite_is_not_valid_for_use() {
        let c = code(|c| InviteCode {
            is_active: false,
            ..c
        });
        assert!(!c.is_valid_for_use(1000));
    }

    #[test]
    fn expired_account_link_is_not_valid_for_use() {
        let c = code(|c| InviteCode {
            code_type: InviteCodeType::AccountLink,
            link_expires_at: Some(500),
            ..c
        });
        assert!(!c.is_valid_for_use(1000));
        assert!(c.is_expired(1000));
    }

    #[test]
    fn account_link_before_expiry_is_valid() {
        let c = code(|c| InviteCode {
            code_type: InviteCodeType::AccountLink,
            link_expires_at: Some(1500),
            ..c
        });
        assert!(c.is_valid_for_use(1000));
        assert!(!c.is_expired(1000));
    }

    #[test]
    fn is_account_link_reflects_code_type() {
        let invite = code(|c| c);
        assert!(!invite.is_account_link());

        let link = code(|c| InviteCode {
            code_type: InviteCodeType::AccountLink,
            ..c
        });
        assert!(link.is_account_link());
    }
}
