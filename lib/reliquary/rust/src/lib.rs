//! reliquary: media blob storage domain for the freqhole family of apps.
//!
//! content-addressed blob stores (sqlite-native and indexeddb/opfs-browser), iroh-blobs
//! wrappers, the snatch replication engine, blob acl gating, media helpers. see the repo
//! README and `docs/xl-refactor/PHASE_2_RELIQUARY_RUST.md` in the tomb repo for the full
//! design, and `docs/storage-traits.md` for the `BlobStore` contract.

pub mod blobz;
pub mod db;
pub mod identity;

pub use blobz::{
    BlobRecord, BlobStore, BlobStoreError, BlobType, NewBlobMeta, SoftDeleteOutcome,
    SqliteBlobStore, UsageStats,
};
pub use db::{DbError, DB_FILENAME};
pub use identity::{
    generate_keypair, get_identity_info, keypair_path, load_keypair, load_or_generate_keypair,
    IdentityError, ReliquaryIdentity, DEFAULT_KEYPAIR_FILENAME,
};

#[cfg(feature = "test-utils")]
pub mod testing {
    //! fixtures and fake stores for consumer test suites.
    //! filled in alongside the rest of the crate as more modules land.
}
