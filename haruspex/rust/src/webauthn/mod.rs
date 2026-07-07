//! webauthn ceremony handlers (feature `webauthn`), wrapping `webauthn-rs`.
//!
//! see `ceremony`'s module docs for the full design (invite-code linkage,
//! node linking) and `rp` for the thin relying-party wrapper. grounded in
//! grimoire's real `offal/auth/webauthn_p2p.rs` (the direct ancestor of this
//! module, per PHASE_4_HARUSPEX_RUST.md) and `users/webauthn.rs` (read-only
//! research, not modified).

pub mod ceremony;
pub mod rp;

pub use ceremony::{
    LoginFinishOutcome, RegisterFinishOutcome, RegisterStartArgs, WebauthnCeremony, WebauthnError,
};
pub use rp::PasskeyRp;

#[cfg(test)]
mod tests;
