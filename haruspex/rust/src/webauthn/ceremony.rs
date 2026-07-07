//! the four webauthn ceremony handlers, as plain transport-free functions -
//! no cookie session, no http/p2p framing. ported from grimoire's real
//! `offal/auth/webauthn_p2p.rs` (read-only research), which is exactly this
//! logic wrapped in p2p request/response bodies; that wrapping is a later,
//! transport-adapter task (deferred per PHASE_4_HARUSPEX_RUST.md), not this
//! module's job.
//!
//! # invite-code / account-link linkage
//!
//! grimoire's donor resolves an invite code to a target user (or checks a
//! username is free) BEFORE calling into the webauthn ceremony, using its
//! own invite-code service; this crate has no `InviteStore` yet (that store
//! is a separate, later task per the module map). so `register_start` here
//! takes an already-resolved `identity_id` (the identity the new passkey
//! will belong to - freshly created by the caller for a brand-new
//! registration, or an existing one for an account-link) plus
//! `is_account_link`/`invite_code` purely as pass-through fields: they ride
//! along in the `ChallengeStore` row across the nonce round-trip (the real
//! mechanism grimoire uses, ported directly) so `register_finish`'s caller
//! can act on them afterward (e.g. mark the invite code redeemed) - this
//! module never validates or redeems a code itself.
//!
//! # node linking
//!
//! on success, `register_finish`/`login_finish` link the caller-supplied
//! `node_id` to the authenticated identity via `IdentityStore::add_device`
//! when one is given, mirroring the donor's `add_peer_node` calls ("the key
//! p2p auth payoff: subsequent requests from this node are auto-
//! authenticated without a passkey").

use serde_json::Value as JsonValue;
use thiserror::Error;
use uuid::Uuid;
use webauthn_rs::prelude::{
    CreationChallengeResponse, DiscoverableAuthentication, Passkey, PasskeyAuthentication,
    PasskeyRegistration, PublicKeyCredential, RegisterPublicKeyCredential,
    RequestChallengeResponse,
};

use crate::error::StoreError;
use crate::identity::DeviceNode;
use crate::stores::{
    ChallengeKind, ChallengeStore, Credential, CredentialStore, IdentityStore, SaveChallengeArgs,
};

use super::rp::PasskeyRp;

#[derive(Debug, Error)]
pub enum WebauthnError {
    #[error("store error: {0}")]
    Store(#[from] StoreError),
    #[error("invalid or expired challenge")]
    InvalidChallenge,
    #[error("invalid credential: {0}")]
    InvalidCredential(String),
    #[error("webauthn ceremony failed: {0}")]
    Ceremony(String),
    #[error("no credentials registered for this identity")]
    NoCredentials,
    #[error("passkey authentication failed")]
    AuthenticationFailed,
}

/// the outcome of a successful `register_finish` call - carries the
/// account-link/invite-code fields through so the caller can act on them
/// (see module docs).
#[derive(Debug)]
pub struct RegisterFinishOutcome {
    pub credential: Credential,
    pub is_account_link: bool,
    pub invite_code: Option<String>,
}

/// the outcome of a successful `login_finish` call.
#[derive(Debug)]
pub struct LoginFinishOutcome {
    pub identity_id: Uuid,
}

/// arguments for `WebauthnCeremony::register_start`, grouped into a struct
/// so the method stays under clippy's argument-count lint.
pub struct RegisterStartArgs<'a> {
    pub identity_id: Uuid,
    pub username: &'a str,
    pub is_account_link: bool,
    pub invite_code: Option<&'a str>,
    pub now: i64,
    pub challenge_ttl_secs: i64,
}

/// groups the relying-party identity + the three stores every ceremony
/// handler needs. construct one per request (cheap - it's just borrowed
/// references) and call the four methods below.
pub struct WebauthnCeremony<'a> {
    pub rp_id: &'a str,
    pub rp_name: &'a str,
    pub credentials: &'a dyn CredentialStore,
    pub challenges: &'a dyn ChallengeStore,
    pub identities: &'a dyn IdentityStore,
}

impl<'a> WebauthnCeremony<'a> {
    fn rp(&self) -> PasskeyRp {
        PasskeyRp::new(self.rp_id.to_string(), self.rp_name.to_string())
    }

    async fn stored_passkeys(&self, identity_id: Uuid) -> Result<Vec<Passkey>, WebauthnError> {
        self.credentials
            .list_for_identity(identity_id)
            .await?
            .into_iter()
            .map(|c| {
                serde_json::from_value(c.credential_data)
                    .map_err(|e| WebauthnError::Ceremony(format!("stored passkey is corrupt: {e}")))
            })
            .collect()
    }

    /// start passkey registration. `args.identity_id` is the identity this
    /// passkey will belong to - see module docs for why the caller resolves
    /// this before calling in, rather than this function taking an invite
    /// code itself.
    pub async fn register_start(
        &self,
        origin: &str,
        args: RegisterStartArgs<'_>,
    ) -> Result<(CreationChallengeResponse, String), WebauthnError> {
        let RegisterStartArgs {
            identity_id,
            username,
            is_account_link,
            invite_code,
            now,
            challenge_ttl_secs,
        } = args;

        let exclude_credentials = if is_account_link {
            self.stored_passkeys(identity_id)
                .await?
                .iter()
                .map(|p| p.cred_id().clone())
                .collect()
        } else {
            vec![]
        };

        let (ccr, reg_state) = self
            .rp()
            .start_registration(origin, identity_id, username, exclude_credentials)
            .map_err(WebauthnError::Ceremony)?;

        let challenge_json = serde_json::to_string(&reg_state)
            .map_err(|e| WebauthnError::Ceremony(format!("failed to serialize challenge: {e}")))?;

        let nonce = self
            .challenges
            .save(SaveChallengeArgs {
                kind: ChallengeKind::Registration,
                challenge_json,
                identity_id: Some(identity_id),
                username: Some(username.to_string()),
                is_account_link,
                invite_code: invite_code.map(str::to_string),
                created_at: now,
                expires_at: now + challenge_ttl_secs,
            })
            .await?;

        Ok((ccr, nonce))
    }

    /// finish passkey registration: verifies `credential` against the
    /// challenge named by `nonce`, persists the resulting passkey via
    /// `CredentialStore`, and links `node_id` (if given) to the identity.
    pub async fn register_finish(
        &self,
        origin: &str,
        nonce: &str,
        credential: JsonValue,
        node_id: Option<&str>,
        now: i64,
    ) -> Result<RegisterFinishOutcome, WebauthnError> {
        let challenge = self
            .challenges
            .take(nonce, ChallengeKind::Registration, now)
            .await?
            .ok_or(WebauthnError::InvalidChallenge)?;

        let identity_id = challenge
            .identity_id
            .ok_or_else(|| WebauthnError::Ceremony("challenge missing identity_id".to_string()))?;

        let reg_state: PasskeyRegistration = serde_json::from_str(&challenge.challenge_json)
            .map_err(|e| {
                WebauthnError::Ceremony(format!("failed to deserialize challenge: {e}"))
            })?;

        let reg_credential: RegisterPublicKeyCredential = serde_json::from_value(credential)
            .map_err(|e| WebauthnError::InvalidCredential(e.to_string()))?;

        let passkey = self
            .rp()
            .finish_registration(origin, &reg_credential, &reg_state)
            .map_err(WebauthnError::Ceremony)?;

        let credential_data = serde_json::to_value(&passkey)
            .map_err(|e| WebauthnError::Ceremony(format!("failed to serialize passkey: {e}")))?;

        let saved = self
            .credentials
            .add_credential(Credential {
                id: String::new(),
                identity_id,
                credential_id: passkey.cred_id().as_ref().to_vec(),
                credential_data,
                name: None,
                created_at: now,
                last_used_at: None,
                deleted_at: None,
            })
            .await?;

        if let Some(node_id) = node_id {
            self.link_node(identity_id, node_id, now).await?;
        }

        Ok(RegisterFinishOutcome {
            credential: saved,
            is_account_link: challenge.is_account_link,
            invite_code: challenge.invite_code,
        })
    }

    /// start passkey authentication. `identity` is `Some((identity_id,
    /// username))` for the targeted flow (specific credentials offered), or
    /// `None` for the discoverable flow (the authenticator presents whatever
    /// passkeys it has for this rp; the identity is resolved from the
    /// credential's raw id in `login_finish`).
    pub async fn login_start(
        &self,
        origin: &str,
        identity: Option<(Uuid, &str)>,
        now: i64,
        challenge_ttl_secs: i64,
    ) -> Result<(RequestChallengeResponse, String), WebauthnError> {
        match identity {
            Some((identity_id, username)) => {
                let passkeys = self.stored_passkeys(identity_id).await?;
                if passkeys.is_empty() {
                    return Err(WebauthnError::NoCredentials);
                }

                let (rcr, auth_state) = self
                    .rp()
                    .start_authentication(origin, &passkeys)
                    .map_err(WebauthnError::Ceremony)?;

                let challenge_json = serde_json::to_string(&auth_state).map_err(|e| {
                    WebauthnError::Ceremony(format!("failed to serialize challenge: {e}"))
                })?;

                let nonce = self
                    .challenges
                    .save(SaveChallengeArgs {
                        kind: ChallengeKind::Authentication,
                        challenge_json,
                        identity_id: Some(identity_id),
                        username: Some(username.to_string()),
                        is_account_link: false,
                        invite_code: None,
                        created_at: now,
                        expires_at: now + challenge_ttl_secs,
                    })
                    .await?;

                Ok((rcr, nonce))
            }
            None => {
                let (rcr, auth_state) = self
                    .rp()
                    .start_discoverable_authentication(origin)
                    .map_err(WebauthnError::Ceremony)?;

                let challenge_json = serde_json::to_string(&auth_state).map_err(|e| {
                    WebauthnError::Ceremony(format!("failed to serialize challenge: {e}"))
                })?;

                let nonce = self
                    .challenges
                    .save(SaveChallengeArgs {
                        kind: ChallengeKind::DiscoverableAuthentication,
                        challenge_json,
                        identity_id: None,
                        username: None,
                        is_account_link: false,
                        invite_code: None,
                        created_at: now,
                        expires_at: now + challenge_ttl_secs,
                    })
                    .await?;

                Ok((rcr, nonce))
            }
        }
    }

    /// finish passkey authentication, handling both the targeted and
    /// discoverable flows transparently (mirrors the donor exactly: it
    /// tries both challenge kinds under the same nonce since the caller
    /// does not know which flow produced it). on success, links `node_id`
    /// (if given) to the authenticated identity.
    pub async fn login_finish(
        &self,
        origin: &str,
        nonce: &str,
        credential: JsonValue,
        node_id: Option<&str>,
        now: i64,
    ) -> Result<LoginFinishOutcome, WebauthnError> {
        let targeted = self
            .challenges
            .take(nonce, ChallengeKind::Authentication, now)
            .await?;
        let challenge = match targeted {
            Some(c) => c,
            None => self
                .challenges
                .take(nonce, ChallengeKind::DiscoverableAuthentication, now)
                .await?
                .ok_or(WebauthnError::InvalidChallenge)?,
        };

        let auth_credential: PublicKeyCredential = serde_json::from_value(credential)
            .map_err(|e| WebauthnError::InvalidCredential(e.to_string()))?;

        let identity_id = if challenge.kind == ChallengeKind::DiscoverableAuthentication {
            // identify the owning identity from the credential's raw id
            // directly, rather than trusting a user handle the authenticator
            // may not have sent (same reasoning as the donor).
            let cred_id = auth_credential.get_credential_id();
            let stored = self
                .credentials
                .get_credential(cred_id)
                .await?
                .ok_or(WebauthnError::AuthenticationFailed)?;
            let identity_id = stored.identity_id;

            let passkeys = self.stored_passkeys(identity_id).await?;
            let disc_state: DiscoverableAuthentication =
                serde_json::from_str(&challenge.challenge_json).map_err(|e| {
                    WebauthnError::Ceremony(format!("failed to deserialize challenge: {e}"))
                })?;

            let auth_result = self
                .rp()
                .finish_discoverable_authentication(origin, &auth_credential, disc_state, &passkeys)
                .map_err(WebauthnError::Ceremony)?;

            self.credentials
                .touch_last_used(auth_result.cred_id(), now)
                .await?;

            identity_id
        } else {
            let identity_id = challenge.identity_id.ok_or_else(|| {
                WebauthnError::Ceremony("challenge missing identity_id".to_string())
            })?;

            let auth_state: PasskeyAuthentication = serde_json::from_str(&challenge.challenge_json)
                .map_err(|e| {
                    WebauthnError::Ceremony(format!("failed to deserialize challenge: {e}"))
                })?;

            let auth_result = self
                .rp()
                .finish_authentication(origin, &auth_credential, &auth_state)
                .map_err(WebauthnError::Ceremony)?;

            self.credentials
                .touch_last_used(auth_result.cred_id(), now)
                .await?;

            identity_id
        };

        if let Some(node_id) = node_id {
            self.link_node(identity_id, node_id, now).await?;
        }

        Ok(LoginFinishOutcome { identity_id })
    }

    async fn link_node(
        &self,
        identity_id: Uuid,
        node_id: &str,
        now: i64,
    ) -> Result<(), WebauthnError> {
        self.identities
            .add_device(DeviceNode {
                identity_id,
                node_id: node_id.to_string(),
                instance_name: None,
                last_seen_at: now,
                deleted_at: None,
            })
            .await?;
        Ok(())
    }
}
