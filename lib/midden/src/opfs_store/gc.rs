//! garbage collection options for the opfs store.
//!
//! iroh-blobs' own `run_gc` is crate-private and, worse, the sweep-side
//! `blobs().delete()` api is `pub(crate)` too — so an out-of-crate store
//! cannot drive gc through the public api at all. instead the gc cycle
//! runs INSIDE the actor loop (see `actor.rs`): a deadline-based tick
//! interleaved with command handling, marking from persistent tags +
//! batch temp tags + the protect callback (hashseq roots expanded by
//! parsing their 32-byte child hashes), then sweeping unreferenced blobs
//! via direct storage deletes.

use std::time::Duration;

pub use iroh_blobs::store::{ProtectCb, ProtectOutcome};

/// gc configuration (mirrors iroh_blobs::store::GcConfig, which cannot be
/// reused because its consumer is crate-private).
pub struct GcOptions {
    pub interval: Duration,
    pub add_protected: Option<ProtectCb>,
}
