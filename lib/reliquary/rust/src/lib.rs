//! reliquary: media blob storage domain for the freqhole family of apps.
//!
//! content-addressed blob stores (sqlite-native and indexeddb/opfs-browser), iroh-blobs
//! wrappers, the snatch replication engine, blob acl gating, media helpers. see the repo
//! README and `docs/xl-refactor/PHASE_2_RELIQUARY_RUST.md` in the tomb repo for the full
//! design.
//!
//! phase 0 skeleton - no functional code yet.

#[cfg(feature = "test-utils")]
pub mod testing {
    //! fixtures and fake stores for consumer test suites.
    //! filled in alongside the rest of the crate in phase 2.
}
