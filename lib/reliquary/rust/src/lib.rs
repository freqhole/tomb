//! reliquary: media blob storage domain for the freqhole family of apps.
//!
//! content-addressed blob stores (sqlite-native and indexeddb/opfs-browser), iroh-blobs
//! wrappers, the snatch replication engine, blob acl gating, media helpers. see the repo
//! README and `docs/xl-refactor/PHASE_2_RELIQUARY_RUST.md` in the tomb repo for the full
//! design, and `docs/storage-traits.md` for the `BlobStore` contract.
//!
//! ## why this crate never uses sqlx's `query!`/`query_as!` macros
//!
//! this crate is meant to be embedded as a path or git dependency in host apps (skein,
//! tumulus, and others to come), each with their own separate sqlite database and schema.
//! sqlx's compile-time query macros validate sql against whatever database `DATABASE_URL`
//! points at when the crate is compiled - but `DATABASE_URL` is one process-wide setting per
//! `cargo` invocation, not something a library crate can scope to itself. the moment a host
//! app adds this crate as a dependency, compiling the host also expands these macros, and the
//! host's `DATABASE_URL` points at the host's own unrelated schema - the build breaks for
//! every consumer, forever, unless every host maintains its own offline query cache just to
//! satisfy a dependency's internal queries. that's a permanent tax on every consumer for a
//! benefit (compile-time sql validation) that only this crate's own author needs.
//!
//! every query in this crate therefore uses the runtime-checked `sqlx::query`/`query_as`
//! forms instead, with `.bind(...)` for parameters and `#[derive(sqlx::FromRow)]` structs for
//! row types. this trades compile-time sql validation for a normal runtime error path,
//! covered instead by this crate's own test suite. do not reintroduce `query!`/`query_as!`
//! here - it will silently reattach this crate's compilation to a `DATABASE_URL` that has no
//! reason to exist in a consuming host app.

#[cfg(feature = "blobz")]
pub mod blobz;
pub mod db;
#[cfg(feature = "ensure")]
pub mod ensure;
#[cfg(feature = "gate")]
pub mod gate;
pub mod hash;
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
pub use hash::{hash_bytes, hash_file, HashError};
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

/// test fixtures + fake stores for consumer test suites, behind the
/// `test-utils` cargo feature.
#[cfg(feature = "test-utils")]
pub mod testing;
