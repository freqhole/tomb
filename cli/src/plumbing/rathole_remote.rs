//! CLI commands for managing rathole pending remote connections.
//!
//! covers the "add remote" flow: storing an invite code or creating a knock
//! request locally, listing pending connections, checking their status,
//! and removing them.
//!
//! network operations (actually sending the knock to the server, or redeeming
//! an invite code) happen inside the rathole TUI. the CLI commands here
//! manage local state only.

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use rathole::tty::pending_remotes;

#[derive(Subcommand)]
pub enum RatholeRemoteAction {
    /// add a pending remote: store an address (or invite code) for later
    /// connection via the rathole TUI.
    ///
    /// `input` can be:
    ///   - a 64-char hex iroh node id (p2p transport)
    ///   - an http(s):// url (http transport)
    ///   - an invite code (stored for redemption when the TUI connects)
    ///
    /// if the peer requires access, use `--username` and optionally
    /// `--message` to pre-fill the knock request fields. the TUI will
    /// send the knock when it next connects to that peer.
    #[command(name = "add-remote")]
    AddRemote {
        /// server address, node id, or invite code to store
        input: String,

        /// invite code to use when connecting (if the server requires one)
        #[arg(long)]
        invite: Option<String>,

        /// username for the knock request
        #[arg(long)]
        username: Option<String>,

        /// message for the knock request
        #[arg(long)]
        message: Option<String>,
    },

    /// list all pending remote connection attempts
    #[command(name = "list-pending")]
    ListPending,

    /// show the current (local) state of a pending remote
    ///
    /// reads local state only. to check the live status against the server,
    /// open the rathole TUI and select the pending remote.
    Check {
        /// pending remote id (from list-pending)
        id: String,
    },

    /// remove a pending remote entry
    #[command(name = "remove-pending")]
    RemovePending {
        /// pending remote id (from list-pending)
        id: String,
    },
}

/// parse `input` into (peer_addr, transport, stage).
fn parse_input(input: &str, invite: Option<&str>) -> (String, &'static str, &'static str) {
    // 64-char hex = iroh p2p node id
    if input.len() == 64 && input.chars().all(|c| c.is_ascii_hexdigit()) {
        let stage = if invite.is_some() {
            "invited"
        } else {
            "knock_pending"
        };
        return (input.to_string(), "wasm", stage);
    }

    // http url
    if input.starts_with("http://") || input.starts_with("https://") {
        let stage = if invite.is_some() {
            "invited"
        } else {
            "knock_pending"
        };
        return (input.to_string(), "http", stage);
    }

    // treat as invite code — store as-is, user provides server separately
    (input.to_string(), "http", "invited")
}

pub fn handle_command(action: RatholeRemoteAction) -> CommandOutput<serde_json::Value> {
    match action {
        RatholeRemoteAction::AddRemote {
            input,
            invite,
            username,
            message,
        } => {
            let invite_ref = invite.as_deref();
            let (peer_addr, transport, stage) = parse_input(&input, invite_ref);

            // if the raw input looks like a bare invite code (not a url / node id),
            // we store the code directly in `invite_code` and leave `peer_addr`
            // blank for the user to fill in via the TUI.
            let effective_invite = if input.len() != 64
                && !input.starts_with("http://")
                && !input.starts_with("https://")
            {
                Some(input.as_str())
            } else {
                invite_ref
            };

            match pending_remotes::add(
                &peer_addr,
                transport,
                stage,
                effective_invite,
                username.as_deref(),
                message.as_deref(),
            ) {
                Ok(entry) => CommandOutput::success(
                    format!("pending remote added (id: {})", entry.id),
                    serde_json::json!({
                        "id": entry.id,
                        "peer_addr": entry.peer_addr,
                        "transport": entry.transport,
                        "stage": entry.stage,
                        "invite_code": entry.invite_code,
                        "knock_username": entry.knock_username,
                        "knock_message": entry.knock_message,
                        "created_at": entry.created_at,
                    }),
                ),
                Err(e) => CommandOutput::failure(
                    format!("failed to add pending remote: {e}"),
                    vec![],
                    serde_json::Value::Null,
                ),
            }
        }

        RatholeRemoteAction::ListPending => {
            let entries = pending_remotes::list();
            let json: Vec<_> = entries
                .iter()
                .map(|e| {
                    serde_json::json!({
                        "id": e.id,
                        "peer_addr": e.peer_addr,
                        "transport": e.transport,
                        "stage": e.stage,
                        "knock_username": e.knock_username,
                        "invite_code": e.invite_code,
                        "created_at": e.created_at,
                        "updated_at": e.updated_at,
                    })
                })
                .collect();
            let msg = if entries.is_empty() {
                "no pending remotes".to_string()
            } else {
                format!("{} pending remote(s)", entries.len())
            };
            CommandOutput::success(msg, json)
        }

        RatholeRemoteAction::Check { id } => match pending_remotes::get(&id) {
            Some(entry) => CommandOutput::success(
                format!("stage: {}", entry.stage),
                serde_json::json!({
                    "id": entry.id,
                    "peer_addr": entry.peer_addr,
                    "transport": entry.transport,
                    "stage": entry.stage,
                    "server_name": entry.server_name,
                    "knock_id": entry.knock_id,
                    "knock_username": entry.knock_username,
                    "error_message": entry.error_message,
                    "created_at": entry.created_at,
                    "updated_at": entry.updated_at,
                }),
            ),
            None => CommandOutput::failure(
                format!("no pending remote with id: {id}"),
                vec![],
                serde_json::Value::Null,
            ),
        },

        RatholeRemoteAction::RemovePending { id } => match pending_remotes::remove(&id) {
            Ok(true) => CommandOutput::success(
                format!("removed pending remote {id}"),
                serde_json::json!({ "id": id }),
            ),
            Ok(false) => CommandOutput::failure(
                format!("no pending remote with id: {id}"),
                vec![],
                serde_json::Value::Null,
            ),
            Err(e) => CommandOutput::failure(
                format!("failed to remove pending remote: {e}"),
                vec![],
                serde_json::Value::Null,
            ),
        },
    }
}
