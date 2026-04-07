//! per-widget document state types — file, canvas-card, canvas-info.
//!
//! these represent the internal state of individual widgets, stored in
//! separate automerge documents referenced by `WidgetEntry.doc_id`.
//!
//! reference:
//!   - `client/skein/widgets/file.ts`
//!   - `client/skein/widgets/narthex/canvas-card.ts`
//!   - `client/skein/widgets/canvas-info.ts`

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// canvas card role (includes "owner")
// ---------------------------------------------------------------------------

/// role in a canvas card — extends CanvasRole with "owner".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CanvasCardRole {
    Owner,
    Editor,
    Viewer,
}

// ---------------------------------------------------------------------------
// canvas-info active tab
// ---------------------------------------------------------------------------

/// which tab is active in the canvas-info widget.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CanvasInfoTab {
    Details,
    History,
}

// ---------------------------------------------------------------------------
// file widget state
// ---------------------------------------------------------------------------

/// per-widget state for the file widget.
///
/// contains blob metadata for display and P2P fetch. the hub peer reads these
/// to discover blob references for snatching.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWidgetState {
    /// media blob ID from grimoire.
    #[serde(default)]
    pub blob_id: String,
    /// media domain: audio, photo, video, document, file.
    #[serde(default)]
    pub domain: String,
    /// domain entity ID (audioz, photoz, etc.).
    #[serde(default)]
    pub entity_id: String,
    /// original filename.
    #[serde(default)]
    pub filename: String,
    /// MIME type.
    #[serde(default)]
    pub mime: String,
    /// file size in bytes.
    #[serde(default)]
    pub size: u64,
    /// blake3 content hash (for P2P verified fetch).
    #[serde(default)]
    pub blake3: String,
    /// embedded thumbnail as a data URL.
    #[serde(default)]
    pub thumbnail_data_url: String,
}

// ---------------------------------------------------------------------------
// canvas-card widget state
// ---------------------------------------------------------------------------

/// per-widget state for the canvas-card on the narthex.
///
/// represents a canvas in the user's narthex view. the hub peer reads these
/// to discover canvas doc IDs and track update timestamps.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasCardState {
    #[serde(default)]
    pub canvas_doc_id: String,
    #[serde(default = "default_canvas_title")]
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub preview_url: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub modified_at: String,
    #[serde(default)]
    pub author_name: String,
    #[serde(default = "default_canvas_color")]
    pub color: u32,
    #[serde(default)]
    pub is_remote: bool,
    #[serde(default)]
    pub owner_node_id: String,
    #[serde(default)]
    pub owner_username: String,
    #[serde(default = "default_canvas_card_role")]
    pub role: CanvasCardRole,
    #[serde(default)]
    pub access_revoked: bool,
    #[serde(default)]
    pub last_visited_at: String,
    #[serde(default)]
    pub has_updates: bool,
    #[serde(default)]
    pub last_known_modified_at: String,
    #[serde(default)]
    pub last_modified_by: String,
}

fn default_canvas_title() -> String {
    "untitled canvas".to_string()
}

fn default_canvas_color() -> u32 {
    0xd946ef
}

fn default_canvas_card_role() -> CanvasCardRole {
    CanvasCardRole::Owner
}

// ---------------------------------------------------------------------------
// canvas-info widget state
// ---------------------------------------------------------------------------

/// per-widget state for the canvas-info widget (details/history tab).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasInfoState {
    #[serde(default = "default_canvas_info_tab")]
    pub active_tab: CanvasInfoTab,
}

fn default_canvas_info_tab() -> CanvasInfoTab {
    CanvasInfoTab::Details
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_widget_state_round_trip() {
        let state = FileWidgetState {
            blob_id: "blob-123".to_string(),
            domain: "audio".to_string(),
            entity_id: "song-456".to_string(),
            filename: "track.mp3".to_string(),
            mime: "audio/mpeg".to_string(),
            size: 5_000_000,
            blake3: "abc123def456".to_string(),
            thumbnail_data_url: String::new(),
        };

        let json = serde_json::to_string(&state).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["blobId"], "blob-123");
        assert_eq!(parsed["entityId"], "song-456");
        assert_eq!(parsed["thumbnailDataUrl"], "");

        // round-trip
        let deserialized: FileWidgetState = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.blob_id, "blob-123");
        assert_eq!(deserialized.size, 5_000_000);
    }

    #[test]
    fn test_canvas_card_state_round_trip() {
        let state = CanvasCardState {
            canvas_doc_id: "doc-1".to_string(),
            title: "my canvas".to_string(),
            description: String::new(),
            preview_url: String::new(),
            created_at: "2025-01-01T00:00:00Z".to_string(),
            modified_at: "2025-06-01T12:00:00Z".to_string(),
            author_name: "alice".to_string(),
            color: 0xff0000,
            is_remote: true,
            owner_node_id: "node-alice".to_string(),
            owner_username: "alice".to_string(),
            role: CanvasCardRole::Editor,
            access_revoked: false,
            last_visited_at: String::new(),
            has_updates: true,
            last_known_modified_at: "2025-05-01T00:00:00Z".to_string(),
            last_modified_by: "node-bob".to_string(),
        };

        let json = serde_json::to_string(&state).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["canvasDocId"], "doc-1");
        assert_eq!(parsed["isRemote"], true);
        assert_eq!(parsed["ownerNodeId"], "node-alice");
        assert_eq!(parsed["role"], "editor");
        assert_eq!(parsed["hasUpdates"], true);
        assert_eq!(parsed["lastKnownModifiedAt"], "2025-05-01T00:00:00Z");
    }

    /// test deserializing a file widget state as JS would produce it.
    #[test]
    fn test_deserialize_js_file_widget() {
        let js_json = r#"{
            "blobId": "blob-abc",
            "domain": "photo",
            "entityId": "",
            "filename": "sunset.jpg",
            "mime": "image/jpeg",
            "size": 2500000,
            "blake3": "deadbeef",
            "thumbnailDataUrl": "data:image/jpeg;base64,..."
        }"#;

        let state: FileWidgetState = serde_json::from_str(js_json).unwrap();
        assert_eq!(state.blob_id, "blob-abc");
        assert_eq!(state.domain, "photo");
        assert_eq!(state.filename, "sunset.jpg");
        assert_eq!(state.blake3, "deadbeef");
    }

    /// test deserializing a canvas-card state as JS would produce it.
    #[test]
    fn test_deserialize_js_canvas_card() {
        let js_json = r#"{
            "canvasDocId": "doc-xyz",
            "title": "untitled canvas",
            "description": "",
            "previewUrl": "",
            "createdAt": "2025-01-01T00:00:00Z",
            "modifiedAt": "",
            "authorName": "",
            "color": 14239983,
            "isRemote": false,
            "ownerNodeId": "",
            "ownerUsername": "",
            "role": "owner",
            "accessRevoked": false,
            "lastVisitedAt": "",
            "hasUpdates": false,
            "lastKnownModifiedAt": "",
            "lastModifiedBy": ""
        }"#;

        let state: CanvasCardState = serde_json::from_str(js_json).unwrap();
        assert_eq!(state.canvas_doc_id, "doc-xyz");
        assert_eq!(state.color, 14239983); // 0xd946ef
        assert_eq!(state.role, CanvasCardRole::Owner);
        assert!(!state.is_remote);
    }

    #[test]
    fn test_canvas_info_state_round_trip() {
        let state = CanvasInfoState {
            active_tab: CanvasInfoTab::History,
        };

        let json = serde_json::to_string(&state).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["activeTab"], "history");

        let deserialized: CanvasInfoState = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.active_tab, CanvasInfoTab::History);
    }
}
