//! cross-cutting video-domain operations: generalized entity_taxonz /
//! playlist_itemz / playback_progressz usage, cross-entity queries, and
//! cascading delete + side-table cleanup.

pub mod delete;
pub mod entity_taxonz;
pub mod entity_urlz;
pub mod playback_progressz;
pub mod playlist_itemz;
pub mod query;
pub mod update;
