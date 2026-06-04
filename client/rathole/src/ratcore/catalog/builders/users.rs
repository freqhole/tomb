//! users command builders.

use crate::ratcore::app::{AdminCommand, ArgKind, ArgSpec, CommandKind};
use crate::ratcore::catalog::widgets::{pick_user, pick_user_peer_node, role_choices};

pub(in crate::ratcore::catalog) fn get() -> AdminCommand {
    AdminCommand {
        name: "users_get".to_string(),
        request_type: "AdminUsersGetRequest".to_string(),
        response_type: "AdminUserSummary".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_user("user_id", "pick a user to inspect")],
    }
}

pub(in crate::ratcore::catalog) fn list() -> AdminCommand {
    // wrap users_list with optional filters. all-blank submits the
    // same `{}` body as the no-arg version, so behavior is unchanged
    // for operators who hit Enter through everything.
    AdminCommand {
        name: "users_list".to_string(),
        request_type: "AdminUsersListRequest".to_string(),
        response_type: "Vec<AdminUserSummary>".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            ArgSpec {
                name: "include_deleted".to_string(),
                kind: ArgKind::OptionalBool { default: None },
                required: false,
                help: Some("←/→ to cycle: unset = default (false)".to_string()),
            },
            ArgSpec {
                name: "username".to_string(),
                kind: ArgKind::Text {
                    placeholder: "(blank = no filter) exact username".to_string(),
                },
                required: false,
                help: None,
            },
            ArgSpec {
                name: "role".to_string(),
                kind: ArgKind::Text {
                    placeholder: "(blank = no filter) e.g. root, admin, member, viewer".to_string(),
                },
                required: false,
                help: None,
            },
            ArgSpec {
                name: "limit".to_string(),
                kind: ArgKind::Number {
                    placeholder: "(blank = default) max rows".to_string(),
                    signed: false,
                    min: Some(1),
                    max: Some(10000),
                },
                required: false,
                help: None,
            },
            ArgSpec {
                name: "offset".to_string(),
                kind: ArgKind::Number {
                    placeholder: "(blank = 0) skip n rows".to_string(),
                    signed: false,
                    min: Some(0),
                    max: None,
                },
                required: false,
                help: None,
            },
        ],
    }
}

pub(in crate::ratcore::catalog) fn update_role() -> AdminCommand {
    AdminCommand {
        name: "users_update_role".to_string(),
        request_type: "AdminUsersUpdateRoleRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            pick_user("user_id", "pick a user"),
            ArgSpec {
                name: "role".to_string(),
                kind: ArgKind::OneOf {
                    choices: role_choices(),
                },
                required: true,
                help: Some("new role (root cannot be assigned this way)".to_string()),
            },
        ],
    }
}

pub(in crate::ratcore::catalog) fn delete() -> AdminCommand {
    AdminCommand {
        name: "users_delete".to_string(),
        request_type: "AdminUsersDeleteRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_user("user_id", "pick a user to soft-delete")],
    }
}

pub(in crate::ratcore::catalog) fn hard_delete() -> AdminCommand {
    AdminCommand {
        name: "users_hard_delete".to_string(),
        request_type: "AdminUsersHardDeleteRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        // hard-delete is destructive; users_list filters to non-deleted
        // by default which is fine — the operator should soft-delete
        // first if they really want this gone.
        args: vec![pick_user("user_id", "pick a user to PERMANENTLY delete")],
    }
}

pub(in crate::ratcore::catalog) fn restore() -> AdminCommand {
    AdminCommand {
        name: "users_restore".to_string(),
        request_type: "AdminUsersRestoreRequest".to_string(),
        response_type: "AdminUserSummary".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        // restore needs to see deleted users, but users_list filters them
        // out by default. for now use a free-text id; m+ could plumb
        // include_deleted through the SelectFrom source args.
        args: vec![ArgSpec {
            name: "user_id".to_string(),
            kind: ArgKind::Text {
                placeholder: "user id of soft-deleted user".to_string(),
            },
            required: true,
            help: None,
        }],
    }
}

pub(in crate::ratcore::catalog) fn generate_account_link() -> AdminCommand {
    AdminCommand {
        name: "users_generate_account_link".to_string(),
        request_type: "AdminUsersGenerateAccountLinkRequest".to_string(),
        response_type: "AdminAccountLinkResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_user(
            "user_id",
            "pick a user to mint an account-link code for",
        )],
    }
}

pub(in crate::ratcore::catalog) fn generate_api_key() -> AdminCommand {
    AdminCommand {
        name: "users_generate_api_key".to_string(),
        request_type: "AdminUsersApiKeyRequest".to_string(),
        response_type: "AdminUserSummary".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_user("user_id", "pick a user to (re)generate an api key for")],
    }
}

pub(in crate::ratcore::catalog) fn revoke_api_key() -> AdminCommand {
    AdminCommand {
        name: "users_revoke_api_key".to_string(),
        request_type: "AdminUsersApiKeyRequest".to_string(),
        response_type: "AdminUserSummary".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_user("user_id", "pick a user whose api key to revoke")],
    }
}

pub(in crate::ratcore::catalog) fn hard_delete_peer_node() -> AdminCommand {
    // permanently delete a peer-node row. uses SelectFrom to pick a
    // node_id from the user's active peers, but kept as plain text
    // for simplicity (the user_id field gates the dropdown).
    AdminCommand {
        name: "users_hard_delete_peer_node".to_string(),
        request_type: "AdminPeersRemoveRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            pick_user("user_id", "pick the owning user"),
            pick_user_peer_node(
                "node_id",
                "user_id",
                "pick a peer node belonging to this user",
            ),
        ],
    }
}

pub(in crate::ratcore::catalog) fn add_peer_node() -> AdminCommand {
    AdminCommand {
        name: "users_add_peer_node".to_string(),
        request_type: "AdminUsersAddPeerNodeRequest".to_string(),
        response_type: "AdminPeerNodeSummary".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            pick_user("user_id", "pick the user that should own this peer"),
            ArgSpec {
                name: "node_id".to_string(),
                kind: ArgKind::Text {
                    placeholder: "iroh node id (64 hex chars)".to_string(),
                },
                required: true,
                help: Some("node id to add to this user".to_string()),
            },
            ArgSpec {
                name: "instance_name".to_string(),
                kind: ArgKind::Text {
                    placeholder: "(optional) friendly name".to_string(),
                },
                required: false,
                help: None,
            },
        ],
    }
}

pub(in crate::ratcore::catalog) fn remove_peer_node() -> AdminCommand {
    AdminCommand {
        name: "users_remove_peer_node".to_string(),
        request_type: "AdminUsersRemovePeerNodeRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            pick_user("user_id", "pick the owning user"),
            pick_user_peer_node(
                "node_id",
                "user_id",
                "pick the peer node association to remove",
            ),
        ],
    }
}
