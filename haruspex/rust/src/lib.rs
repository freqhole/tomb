//! haruspex: auth domain for the freqhole family of apps.
//!
//! identity, devices, roles/groups, acl evaluation, webauthn ceremonies, the knock
//! access-request protocol, and the friendz peer protocol. see the repo README and
//! `docs/xl-refactor/PHASE_4_HARUSPEX_RUST.md` in the tomb repo for the full design.
//!
//! this crate ships: the identity module (`identity`), the six store traits
//! (`stores`) every app-facing api sits behind, and sqlite implementations
//! of five of them (`sqlite`) - `GrantStore`'s real backing depends on the
//! acl evaluator's resource-ancestry model and lands separately.

pub mod error;
pub mod identity;
pub mod sqlite;
pub mod stores;

#[cfg(feature = "test-utils")]
pub mod testing {
    //! fixtures and fake stores for consumer test suites.
    //! filled in alongside the rest of the crate in phase 4.
}
