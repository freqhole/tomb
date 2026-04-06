//! multi-domain media modules
//!
//! supports audio, photos, videos, documents, and generic files,
//! plus cross-domain collections.

pub mod audioz;
pub mod collectionz;
pub mod documentz;
pub mod domain;
pub mod filez;
pub mod ingest;
pub mod photoz;
pub mod videoz;

pub use domain::{classify_domain, MediaDomain};
