//! per-domain command builders. each module exposes `pub(super)` fns
//! returning `AdminCommand`, called from `super::rich_commands()`.

pub(super) mod analytics;
pub(super) mod blobz;
pub(super) mod dir_tags;
pub(super) mod invites;
pub(super) mod jobs;
pub(super) mod knocks;
pub(super) mod maintenance;
pub(super) mod peers;
pub(super) mod public;
pub(super) mod radio;
pub(super) mod users;
