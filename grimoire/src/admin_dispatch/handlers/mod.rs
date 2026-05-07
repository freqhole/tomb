//! per-domain admin command handlers.
//!
//! see `super::handle()` for the dispatch table that calls into these.

pub(super) mod analytics;
pub(super) mod database;
pub(super) mod dir_tags;
pub(super) mod invites;
pub(super) mod jobs;
pub(super) mod knocks;
pub(super) mod library;
pub(super) mod maintenance;
pub(super) mod peers;
pub(super) mod radio;
pub(super) mod server_config;
pub(super) mod users;
