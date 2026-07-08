//! the knock accept side-effect: `KnockOutcome` + the `KnockPolicy` seam.
//!
//! `crate::stores::knock_store` owns the knock record itself (scope, dedup,
//! decision log); this module owns what happens when a responder decides to
//! accept one - tomb's "create user with role", skein's "write acl entry",
//! and playlistz's "store grant" are all `KnockPolicy` implementations of
//! the same seam, per PHASE_4_HARUSPEX_RUST.md's knock section.
//!
//! # auto-accept expressibility
//!
//! `KnockPolicy::on_accept` is only called once *something* has already
//! decided to accept a knock - it is the side-effect, not the decision.
//! that keeps auto-accept expressible without haruspex hardcoding any app's
//! specific rule: a dispatcher sitting in front of `KnockStore` (app code,
//! not this crate) can inspect a freshly created, still-pending
//! `KnockRecord` and immediately call
//! `KnockStore::record_decision(Accepted)` followed by the very same
//! `KnockPolicy::on_accept` a human responder would have triggered - no
//! separate code path is needed for "auto" vs "manual" acceptance, only a
//! different caller of the same two calls.
//!
//! playlistz's rule ("prior explicit grant on a collaborative resource ->
//! auto-accept a knock for a related resource") is expressible this way:
//! before leaving a new resource-scoped knock pending, the dispatcher calls
//! `AclEvaluator::effective_role` for the requesting identity against the
//! broader collaborative resource the new knock relates to; if that already
//! returns `>= Some(Role::Member)`, the dispatcher treats the knock as
//! pre-approved and drives it through `record_decision` + `on_accept`
//! itself. the "is this resource collaborative" predicate is app-specific
//! data haruspex does not own (same reasoning as `Resource` ancestry, see
//! `crate::stores::grant_store::Resource`'s doc comment), so it stays
//! app-side; this crate ships only the two calls the dispatcher chains
//! together.

pub mod policy;

pub use policy::{GrantOnAcceptPolicy, KnockOutcome, KnockPolicy, PolicyError};
