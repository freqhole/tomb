//! messagez state document types — canvas invite/share inbox.
//!
//! reference: `client/skein/widgets/narthex/messagez-widget.ts`

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// privacy enum
// ---------------------------------------------------------------------------

/// who can send us canvas invites.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CanvasInvitesFrom {
    Everyone,
    Friends,
    Nobody,
}

// ---------------------------------------------------------------------------
// invite status
// ---------------------------------------------------------------------------

/// status of a received canvas invite.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InviteStatus {
    Pending,
    Accepted,
    Declined,
}

// ---------------------------------------------------------------------------
// records
// ---------------------------------------------------------------------------

/// a received canvas invite stored in the messagez inbox.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasInviteRecord {
    pub id: String,
    pub canvas_doc_id: String,
    #[serde(default)]
    pub canvas_title: String,
    #[serde(default)]
    pub canvas_description: String,
    #[serde(default)]
    pub canvas_color: u32,
    #[serde(default)]
    pub canvas_preview_url: String,
    pub from_node_id: String,
    #[serde(default)]
    pub from_username: String,
    #[serde(default)]
    pub relayed_by: String,
    pub received_at: String,
    #[serde(default = "default_invite_status")]
    pub status: InviteStatus,
}

fn default_invite_status() -> InviteStatus {
    InviteStatus::Pending
}

/// a canvas share sent to another peer (outbox record).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasShareRecord {
    pub id: String,
    pub canvas_doc_id: String,
    #[serde(default)]
    pub canvas_title: String,
    #[serde(default)]
    pub canvas_description: String,
    #[serde(default)]
    pub canvas_color: u32,
    #[serde(default)]
    pub canvas_preview_url: String,
    pub to_node_id: String,
    #[serde(default)]
    pub to_username: String,
    pub sent_at: String,
    #[serde(default)]
    pub delivered: bool,
    #[serde(default)]
    pub accepted: bool,
    #[serde(default)]
    pub declined: bool,
}

// ---------------------------------------------------------------------------
// root messagez state
// ---------------------------------------------------------------------------

/// the messagez automerge document — inbox for canvas invites and outbox for shares.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagezState {
    #[serde(default)]
    pub invites: Vec<CanvasInviteRecord>,
    #[serde(default)]
    pub shares: Vec<CanvasShareRecord>,
    #[serde(default = "default_canvas_invites_from")]
    pub canvas_invites_from: CanvasInvitesFrom,
}

fn default_canvas_invites_from() -> CanvasInvitesFrom {
    CanvasInvitesFrom::Everyone
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_messagez_state_round_trip() {
        let state = MessagezState {
            invites: vec![CanvasInviteRecord {
                id: "inv-1".to_string(),
                canvas_doc_id: "doc-1".to_string(),
                canvas_title: "shared canvas".to_string(),
                canvas_description: String::new(),
                canvas_color: 0xd946ef,
                canvas_preview_url: String::new(),
                from_node_id: "node-alice".to_string(),
                from_username: "alice".to_string(),
                relayed_by: String::new(),
                received_at: "2025-01-01T00:00:00Z".to_string(),
                status: InviteStatus::Pending,
            }],
            shares: vec![],
            canvas_invites_from: CanvasInvitesFrom::Everyone,
        };

        let json = serde_json::to_string(&state).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["invites"][0]["canvasDocId"], "doc-1");
        assert_eq!(parsed["invites"][0]["fromNodeId"], "node-alice");
        assert_eq!(parsed["invites"][0]["canvasColor"], 0xd946ef);
        assert_eq!(parsed["invites"][0]["status"], "pending");
        assert_eq!(parsed["canvasInvitesFrom"], "everyone");

        // round-trip
        let deserialized: MessagezState = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.invites.len(), 1);
        assert_eq!(deserialized.invites[0].canvas_title, "shared canvas");
    }

    /// test deserializing a messagez state as JS would produce it.
    #[test]
    fn test_deserialize_js_messagez_state() {
        let js_json = r#"{
            "invites": [
                {
                    "id": "inv-abc",
                    "canvasDocId": "doc-xyz",
                    "canvasTitle": "collab",
                    "canvasDescription": "",
                    "canvasColor": 0,
                    "canvasPreviewUrl": "",
                    "fromNodeId": "node-alice",
                    "fromUsername": "alice",
                    "relayedBy": "",
                    "receivedAt": "2025-06-01T12:00:00Z",
                    "status": "accepted"
                }
            ],
            "shares": [],
            "canvasInvitesFrom": "friends"
        }"#;

        let state: MessagezState = serde_json::from_str(js_json).unwrap();
        assert_eq!(state.invites.len(), 1);
        assert_eq!(state.invites[0].status, InviteStatus::Accepted);
        assert_eq!(state.canvas_invites_from, CanvasInvitesFrom::Friends);
    }
}
