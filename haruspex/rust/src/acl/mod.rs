//! the acl evaluator: `effective_role`, resource ancestry, the `RoleResolver`
//! seam, `Caller`, and the `on_access_changed` revocation hook.
//!
//! per PHASE_4_HARUSPEX_RUST.md's "grants + acl: the unified model" (ACCEPTED
//! 2026-07-06):
//!
//! ```text
//! resolve(node_id) -> Identity
//! subjects(identity) = { identity } union groups(identity) union { everyone }
//! effective_role(identity, resource) = max-privilege over RoleGrants
//!     matching (subjects x resource-and-its-ancestors)
//! ```
//!
//! `resolve(node_id) -> Identity` is `IdentityStore::resolve_device` (already
//! landed); this module is everything downstream of having an `identity_id`
//! in hand.
//!
//! # no caching, ever
//!
//! `AclEvaluator::effective_role` re-reads `GroupStore`/`GrantStore` on every
//! call - there is no cache to invalidate. this is deliberate and is what
//! makes the phase doc's revocation semantics true by construction: deleting
//! a `Membership` (`GroupStore::remove_member`) or a `RoleGrant`
//! (`GrantStore::revoke`) changes the result of the very next
//! `effective_role` call, full stop. what does NOT happen automatically is
//! tearing down an already-open connection/stream that was granted access
//! before the revocation - that is what `on_access_changed` (see
//! `access_changed`) is for.
//!
//! # missing grant means no access, by design
//!
//! skein's canvas acl defaults a missing/invalid acl entry to `member`
//! (write-permitted). PHASE_4_HARUSPEX_RUST.md explicitly closes that hole:
//! this evaluator's default for "no matching grant, no resolver override" is
//! `None` (no access), never a fallback role. an app that wants "viewer by
//! default for docs already shared" implements that at the `RoleResolver`
//! level (see `resolver`), not by changing this evaluator's default.

pub mod access_changed;
pub mod caller;
pub mod evaluator;
pub mod resolver;

pub use access_changed::{AccessChangeHub, AccessChangeSubject};
pub use caller::Caller;
pub use evaluator::AclEvaluator;
pub use resolver::RoleResolver;
