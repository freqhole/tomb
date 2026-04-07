//! automerge document types for the skein canvas ecosystem.
//!
//! these types represent the shape of automerge documents as stored and synced
//! between peers. all field names use camelCase serde to match the existing JS
//! wire format.
//!
//! the hub peer reads these to understand canvas structure, find peers, read
//! pending invites, and extract blob references from file widgets.

pub mod canvas;
pub mod messagez;
pub mod social;
pub mod widgets;

// re-export commonly used types
pub use canvas::{CanvasDocument, CanvasPeer, PendingCanvasInvite, WidgetEntry};
pub use messagez::{CanvasInviteRecord, CanvasShareRecord, MessagezState};
pub use social::{FriendEntry, FriendNodeId, ProfileState, SocialState};
pub use widgets::{CanvasCardState, CanvasInfoState, FileWidgetState};
