//! re-exports the shared control-socket listener/protocol - moved to
//! `grimoire::control_socket` so charnel can share it too. see that
//! module (and docs/rathole-control-socket.md) for the full writeup.

pub use grimoire::control_socket::{maybe_spawn, ControlSocketCommand, ControlSocketRequest};
