//! canvas document types — the top-level automerge document for a canvas.
//!
//! reference: `client/skein/src/canvas/canvas-doc.ts`

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use crate::protocol::messages::CanvasRole;

/// a single widget's entry in the canvas document.
///
/// describes the widget's position, size, type, and props as seen by the
/// canvas layout system. the widget's internal state lives in a separate
/// per-widget document (referenced by `doc_id`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub widget_type: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub z_index: i32,
    pub props: HashMap<String, JsonValue>,
    pub collapsed: bool,
    /// user-editable display title shown in the frame header.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// automerge document id for the widget's internal state. null if stateless.
    pub doc_id: Option<String>,
    /// if set, this widget is nested inside another widget (e.g. a bin).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
}

/// a peer that has connected to this canvas via P2P.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasPeer {
    pub node_id: String,
    pub joined_at: String,
    /// ISO timestamp of when this peer last viewed or interacted with this canvas.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen_at: Option<String>,
}

/// a pending canvas invite that hasn't been accepted yet.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingCanvasInvite {
    pub invited_by: String,
    pub invited_by_username: String,
    pub role: CanvasRole,
    pub invited_at: String,
}

/// the top-level canvas document stored in automerge.
///
/// contains the layout of all widgets on the canvas, peer tracking, and
/// pending invites for gossip relay.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasDocument {
    pub version: u32,
    pub widgets: HashMap<String, WidgetEntry>,
    pub title: String,
    pub description: String,
    pub created_at: String,
    pub last_modified: String,
    pub last_modified_by: String,
    /// tag color for the canvas (used for visual theming). 0 means no color set.
    pub color: u32,
    /// data URL for a preview/thumbnail image.
    pub preview_url: String,
    /// peers that have connected to this canvas — used for P2P re-establishment.
    pub peers: HashMap<String, CanvasPeer>,
    /// pending invites for peers who haven't joined yet. keyed by target node ID.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_invites: Option<HashMap<String, PendingCanvasInvite>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_canvas_document_round_trip() {
        let doc = CanvasDocument {
            version: 1,
            widgets: HashMap::new(),
            title: "test canvas".to_string(),
            description: "a test".to_string(),
            created_at: "2025-01-01T00:00:00Z".to_string(),
            last_modified: "2025-01-01T00:00:00Z".to_string(),
            last_modified_by: "node-abc".to_string(),
            color: 0,
            preview_url: String::new(),
            peers: HashMap::new(),
            pending_invites: None,
        };

        let json = serde_json::to_string(&doc).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // verify camelCase field names
        assert_eq!(parsed["createdAt"], "2025-01-01T00:00:00Z");
        assert_eq!(parsed["lastModified"], "2025-01-01T00:00:00Z");
        assert_eq!(parsed["lastModifiedBy"], "node-abc");
        assert_eq!(parsed["previewUrl"], "");
        // pendingInvites should be absent (skip_serializing_if)
        assert!(parsed.get("pendingInvites").is_none());

        // round-trip
        let deserialized: CanvasDocument = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.title, "test canvas");
        assert_eq!(deserialized.version, 1);
    }

    #[test]
    fn test_widget_entry_round_trip() {
        let entry = WidgetEntry {
            id: "widget-1".to_string(),
            widget_type: "file".to_string(),
            x: 100.0,
            y: 200.0,
            width: 280.0,
            height: 200.0,
            z_index: 5,
            props: HashMap::new(),
            collapsed: false,
            title: Some("my file".to_string()),
            doc_id: Some("doc-xyz".to_string()),
            parent_id: None,
        };

        let json = serde_json::to_string(&entry).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["type"], "file");
        assert_eq!(parsed["zIndex"], 5);
        assert_eq!(parsed["docId"], "doc-xyz");
        // parentId should be absent
        assert!(parsed.get("parentId").is_none());
    }

    #[test]
    fn test_canvas_peer_round_trip() {
        let peer = CanvasPeer {
            node_id: "node-abc".to_string(),
            joined_at: "2025-01-01T00:00:00Z".to_string(),
            last_seen_at: Some("2025-06-01T12:00:00Z".to_string()),
        };

        let json = serde_json::to_string(&peer).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["nodeId"], "node-abc");
        assert_eq!(parsed["joinedAt"], "2025-01-01T00:00:00Z");
        assert_eq!(parsed["lastSeenAt"], "2025-06-01T12:00:00Z");
    }

    /// test deserializing a canvas document as JS would produce it.
    #[test]
    fn test_deserialize_js_canvas_doc() {
        let js_json = r#"{
            "version": 1,
            "widgets": {
                "w1": {
                    "id": "w1",
                    "type": "file",
                    "x": 10,
                    "y": 20,
                    "width": 300,
                    "height": 200,
                    "zIndex": 1,
                    "props": {},
                    "collapsed": false,
                    "docId": "doc-w1"
                }
            },
            "title": "collab canvas",
            "description": "",
            "createdAt": "2025-01-01T00:00:00Z",
            "lastModified": "2025-06-01T12:00:00Z",
            "lastModifiedBy": "node-alice",
            "color": 0,
            "previewUrl": "",
            "peers": {
                "node-alice": {
                    "nodeId": "node-alice",
                    "joinedAt": "2025-01-01T00:00:00Z"
                }
            },
            "pendingInvites": {
                "node-bob": {
                    "invitedBy": "node-alice",
                    "invitedByUsername": "alice",
                    "role": "editor",
                    "invitedAt": "2025-06-01T12:00:00Z"
                }
            }
        }"#;

        let doc: CanvasDocument = serde_json::from_str(js_json).unwrap();
        assert_eq!(doc.title, "collab canvas");
        assert_eq!(doc.widgets.len(), 1);
        assert_eq!(doc.widgets["w1"].widget_type, "file");
        assert_eq!(doc.peers.len(), 1);
        assert!(doc.peers.contains_key("node-alice"));

        let invites = doc.pending_invites.unwrap();
        assert_eq!(invites.len(), 1);
        assert_eq!(invites["node-bob"].invited_by, "node-alice");
    }
}
