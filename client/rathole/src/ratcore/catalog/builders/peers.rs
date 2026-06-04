//! peers command builders.

use crate::ratcore::app::{AdminCommand, ArgKind, ArgSpec, CommandKind};
use crate::ratcore::catalog::widgets::{mirror_peer_node, pick_peer, pick_user, role_choices};

pub(in crate::ratcore::catalog) fn list_all() -> AdminCommand {
    AdminCommand {
        name: "peers_list_all".to_string(),
        request_type: "AdminPeersListAllRequest".to_string(),
        response_type: "Vec<AdminPeerSummary>".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![ArgSpec {
            name: "include_deleted".to_string(),
            kind: ArgKind::OptionalBool { default: None },
            required: false,
            help: Some("←/→ to cycle: unset = default (false)".to_string()),
        }],
    }
}

pub(in crate::ratcore::catalog) fn list_for_user() -> AdminCommand {
    AdminCommand {
        name: "peers_list_for_user".to_string(),
        request_type: "AdminPeersListForUserRequest".to_string(),
        response_type: "Vec<AdminPeerNodeSummary>".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            pick_user("user_id", "pick a user to list peers for"),
            ArgSpec {
                name: "include_deleted".to_string(),
                kind: ArgKind::OptionalBool { default: None },
                required: false,
                help: Some("←/→ to cycle: unset = default (false)".to_string()),
            },
        ],
    }
}

pub(in crate::ratcore::catalog) fn remove() -> AdminCommand {
    AdminCommand {
        name: "peers_remove".to_string(),
        request_type: "AdminPeersRemoveRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            pick_peer("user_id", "pick the peer to remove"),
            mirror_peer_node("node_id", "user_id"),
        ],
    }
}

pub(in crate::ratcore::catalog) fn restore() -> AdminCommand {
    AdminCommand {
        name: "peers_restore".to_string(),
        request_type: "AdminPeersRestoreRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            pick_peer("user_id", "pick the peer to restore"),
            mirror_peer_node("node_id", "user_id"),
        ],
    }
}

pub(in crate::ratcore::catalog) fn allow() -> AdminCommand {
    AdminCommand {
        name: "peers_allow".to_string(),
        request_type: "AdminPeersAllowRequest".to_string(),
        response_type: "AdminPeersAllowResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            ArgSpec {
                name: "node_id".to_string(),
                kind: ArgKind::Text {
                    placeholder: "node id to allow".to_string(),
                },
                required: true,
                help: Some("the iroh node id to admit".to_string()),
            },
            ArgSpec {
                name: "username".to_string(),
                kind: ArgKind::Text {
                    placeholder: "(optional) username to attach".to_string(),
                },
                required: false,
                help: None,
            },
            ArgSpec {
                name: "role".to_string(),
                kind: ArgKind::OneOf {
                    choices: role_choices(),
                },
                required: true,
                help: Some("role for the new peer".to_string()),
            },
        ],
    }
}

pub(in crate::ratcore::catalog) fn hard_delete() -> AdminCommand {
    AdminCommand {
        name: "peers_hard_delete".to_string(),
        request_type: "AdminPeersHardDeleteRequest".to_string(),
        response_type: "AdminPeersHardDeleteResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![ArgSpec {
            name: "node_id".to_string(),
            kind: ArgKind::SelectFrom {
                source_command: "peers_list_all".to_string(),
                source_body: serde_json::json!({ "include_deleted": true }),
                body_from_fields: vec![],
                data_path: String::new(),
                value_field: "node_id".to_string(),
                label_field: "node_id".to_string(),
            },
            required: true,
            help: Some("permanently delete this node from all user associations".to_string()),
        }],
    }
}

pub(in crate::ratcore::catalog) fn reassign_user() -> AdminCommand {
    AdminCommand {
        name: "peers_reassign_user".to_string(),
        request_type: "AdminPeersReassignUserRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            ArgSpec {
                name: "node_id".to_string(),
                kind: ArgKind::SelectFrom {
                    source_command: "peers_list_all".to_string(),
                    source_body: serde_json::json!({ "include_deleted": true }),
                    body_from_fields: vec![],
                    data_path: String::new(),
                    value_field: "node_id".to_string(),
                    label_field: "node_id".to_string(),
                },
                required: true,
                help: Some("pick peer node to reassign".to_string()),
            },
            pick_user("user_id", "pick the destination user (root excluded)"),
        ],
    }
}
