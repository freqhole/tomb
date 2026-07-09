//! haruspex: auth domain for the freqhole family of apps.
//!
//! identity, devices, roles/groups, acl evaluation, webauthn ceremonies, the
//! knock access-request protocol, and the friendz peer protocol. see the
//! repo README for the full design.
//!
//! this crate ships: the identity module (`identity`), the store traits
//! (`stores`) every app-facing api sits behind, sqlite implementations of
//! all of them (`sqlite`), the acl evaluator (`acl`) - `effective_role`,
//! the `RoleResolver` seam, `Caller`, and the `on_access_changed` revocation
//! hook - the knock accept side-effect seam (`knock`) - `KnockOutcome` and
//! the `KnockPolicy` trait - the friendz wire protocol (`protocol`),
//! which covers message types, codec, the transport-agnostic
//! `FriendzService`, and gossip digest computation/merge logic - and the
//! auth-flavored subset of the hub admin protocol (`hub_admin`) - friend
//! crud, admin promote/demote, and profile get/set over the stores above.

pub mod acl;
pub mod error;
pub mod hub_admin;
pub mod identity;
pub mod knock;
pub mod protocol;
pub mod sqlite;
pub mod stores;

/// webauthn ceremony handlers (register/login start+finish) + the
/// `PasskeyRp` relying-party wrapper. wraps `webauthn-rs`; off by default,
/// see `Cargo.toml`'s `webauthn` feature.
#[cfg(feature = "webauthn")]
pub mod webauthn;

#[cfg(feature = "test-utils")]
pub mod testing;
