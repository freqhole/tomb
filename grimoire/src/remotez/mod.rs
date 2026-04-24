//! shared remote registry
//!
//! a single sqlite-backed list of remote freqhole instances the user can
//! connect to. used by both the spume player (in tauri) and the wizard admin
//! app, so they share one source of truth.
//!
//! pure-web spume continues to use IndexedDB; this module only runs in tauri
//! context (or anywhere the grimoire database is reachable).

pub mod models;
pub mod repository;

pub use models::{Remote, RemoteTransport, UpsertRemoteRequest};
pub use repository::RemoteRepository;
