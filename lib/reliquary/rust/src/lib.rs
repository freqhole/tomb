//! reliquary: media blob storage domain for the freqhole family of apps.
//!
//! content-addressed blob stores (sqlite-native and indexeddb/opfs-browser), iroh-blobs
//! wrappers, the snatch replication engine, blob acl gating, media helpers. see the repo
//! README and `docs/xl-refactor/PHASE_2_RELIQUARY_RUST.md` in the tomb repo for the full
//! design, and `docs/storage-traits.md` for the `BlobStore` contract.

#[cfg(feature = "blobz")]
pub mod blobz;
pub mod db;
#[cfg(feature = "ensure")]
pub mod ensure;
#[cfg(feature = "gate")]
pub mod gate;
#[cfg(feature = "identity")]
pub mod identity;
#[cfg(feature = "media")]
pub mod media;
#[cfg(feature = "node")]
pub mod node;
#[cfg(feature = "snatch")]
pub mod snatch;

#[cfg(feature = "blobz")]
pub use blobz::{
    BlobRecord, BlobStore, BlobStoreError, BlobType, NewBlobMeta, SoftDeleteOutcome,
    SqliteBlobStore, UsageStats,
};
pub use db::{DbError, DB_FILENAME};
#[cfg(feature = "ensure")]
pub use ensure::{EnsureBlobHandler, PeerMessage};
#[cfg(feature = "gate")]
pub use gate::{build_gated_blobs_events, AccessGate, AllowAll};
#[cfg(feature = "identity")]
pub use identity::{
    generate_keypair, get_identity_info, keypair_path, load_keypair, load_or_generate_keypair,
    IdentityError, ReliquaryIdentity, DEFAULT_KEYPAIR_FILENAME,
};
#[cfg(feature = "node")]
pub use node::{InFlightGuard, NodeError, StorageNode, StorageNodeOptions};
#[cfg(feature = "snatch")]
pub use snatch::{
    BlobDescriptor, BlobRefSource, PeerProbeTransport, ProbeError, SnatchEngine,
    SnatchEngineOptions, SnatchError,
};

// testing: fixtures + fake stores for consumer test suites (reliquary::testing). not landed
// yet - same dangling-mod caveat as snatch above; uncomment together with the file.
// #[cfg(feature = "test-utils")]
// pub mod testing;
