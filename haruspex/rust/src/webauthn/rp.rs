//! thin wrapper over `webauthn_rs::Webauthn`.
//!
//! ported from grimoire's real `GrimoireWebAuthn` (read-only research against
//! `grimoire/src/users/webauthn.rs`), which itself mirrors
//! `server/src/auth/freq_webauthn.rs`'s `FreqWebauthn` so http and p2p share
//! one implementation. the only behavioral change from the donor: passkey
//! registration takes the identity's own `Uuid` directly as webauthn-rs's
//! `user_unique_id` - the donor derives a `Uuid::new_v5` from a string user
//! id because tomb's user ids are strings; haruspex's `Identity::id` is
//! already a `Uuid`, so no derivation step is needed.

use uuid::Uuid;
use webauthn_rs::prelude::{
    AuthenticationResult, CreationChallengeResponse, CredentialID, DiscoverableAuthentication,
    DiscoverableKey, Passkey, PasskeyAuthentication, PasskeyRegistration, PublicKeyCredential,
    RegisterPublicKeyCredential, RequestChallengeResponse, Url,
};
use webauthn_rs::{Webauthn, WebauthnBuilder};

/// a relying party wrapper scoped to one `(rp_id, rp_name)` pair. cheap to
/// construct - build a fresh one per request, same as the donor.
pub struct PasskeyRp {
    rp_id: String,
    rp_name: String,
}

impl PasskeyRp {
    pub fn new(rp_id: impl Into<String>, rp_name: impl Into<String>) -> Self {
        Self {
            rp_id: rp_id.into(),
            rp_name: rp_name.into(),
        }
    }

    fn build(&self, origin: &str) -> Result<Webauthn, String> {
        let rp_origin = Url::parse(origin).map_err(|e| format!("invalid origin url: {e}"))?;
        WebauthnBuilder::new(&self.rp_id, &rp_origin)
            .map_err(|e| format!("failed to create webauthn builder: {e}"))?
            .rp_name(&self.rp_name)
            .build()
            .map_err(|e| format!("failed to build webauthn: {e}"))
    }

    pub fn start_registration(
        &self,
        origin: &str,
        identity_id: Uuid,
        username: &str,
        exclude_credentials: Vec<CredentialID>,
    ) -> Result<(CreationChallengeResponse, PasskeyRegistration), String> {
        let webauthn = self.build(origin)?;
        webauthn
            .start_passkey_registration(identity_id, username, username, Some(exclude_credentials))
            .map_err(|e| format!("start_registration failed: {e}"))
    }

    pub fn finish_registration(
        &self,
        origin: &str,
        reg: &RegisterPublicKeyCredential,
        state: &PasskeyRegistration,
    ) -> Result<Passkey, String> {
        let webauthn = self.build(origin)?;
        webauthn
            .finish_passkey_registration(reg, state)
            .map_err(|e| format!("finish_registration failed: {e}"))
    }

    pub fn start_authentication(
        &self,
        origin: &str,
        credentials: &[Passkey],
    ) -> Result<(RequestChallengeResponse, PasskeyAuthentication), String> {
        let webauthn = self.build(origin)?;
        webauthn
            .start_passkey_authentication(credentials)
            .map_err(|e| format!("start_authentication failed: {e}"))
    }

    pub fn finish_authentication(
        &self,
        origin: &str,
        auth: &PublicKeyCredential,
        state: &PasskeyAuthentication,
    ) -> Result<AuthenticationResult, String> {
        let webauthn = self.build(origin)?;
        webauthn
            .finish_passkey_authentication(auth, state)
            .map_err(|e| format!("finish_authentication failed: {e}"))
    }

    /// starts a discoverable-credential authentication challenge (no
    /// username/identity required up front) - the client sends an empty
    /// `allowCredentials` list and the platform authenticator presents
    /// whatever passkeys it holds for this rp.
    pub fn start_discoverable_authentication(
        &self,
        origin: &str,
    ) -> Result<(RequestChallengeResponse, DiscoverableAuthentication), String> {
        let webauthn = self.build(origin)?;
        webauthn
            .start_discoverable_authentication()
            .map_err(|e| format!("start_discoverable_authentication failed: {e}"))
    }

    /// completes a discoverable-credential authentication given the stored
    /// challenge and the specific credentials belonging to the identity
    /// already identified from the credential response's raw id (see
    /// `ceremony::login_finish` - it looks the identity up via
    /// `CredentialStore::get_credential` rather than trusting a user handle,
    /// same as the donor).
    pub fn finish_discoverable_authentication(
        &self,
        origin: &str,
        reg: &PublicKeyCredential,
        state: DiscoverableAuthentication,
        creds: &[Passkey],
    ) -> Result<AuthenticationResult, String> {
        let webauthn = self.build(origin)?;
        let discoverable_keys: Vec<DiscoverableKey> =
            creds.iter().map(DiscoverableKey::from).collect();
        webauthn
            .finish_discoverable_authentication(reg, state, &discoverable_keys)
            .map_err(|e| format!("finish_discoverable_authentication failed: {e}"))
    }
}
