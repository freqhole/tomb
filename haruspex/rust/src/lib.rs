//! haruspex: auth domain for the freqhole family of apps.
//!
//! identity, devices, roles/groups, acl evaluation, webauthn ceremonies, the knock
//! access-request protocol, and the friendz peer protocol. see the repo README and
//! `docs/xl-refactor/PHASE_4_HARUSPEX_RUST.md` in the tomb repo for the full design.
//!
//! phase 0 skeleton - no functional code yet.

#[cfg(feature = "test-utils")]
pub mod testing {
    //! fixtures and fake stores for consumer test suites.
    //! filled in alongside the rest of the crate in phase 4.
}
