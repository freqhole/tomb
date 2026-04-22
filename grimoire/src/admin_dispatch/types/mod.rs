//! typed request/response structs for the admin dispatch surface.
//!
//! every command exposed via `admin_dispatch::registry::all_commands()`
//! has matching request and response types here, derived with `ZodSchema`
//! so the typescript client gets compile-time-checked envelopes for
//! `freqhole-admin/1` ALPN traffic.
//!
//! existing domain types (e.g. `KnockRequest`) are reused directly when
//! their wire shape already matches what dispatch returns.

pub mod invites;
pub mod knocks;
pub mod peers;
pub mod users;
