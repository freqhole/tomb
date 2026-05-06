//! shared seed list of admin commands surfaced by both shells.
//!
//! historically each shell hand-rolled its own list:
//! - the wasm shell had `sample_commands()` (knocks_list,
//!   users_list, server_info, knock).
//! - the tty shell pulled `grimoire::admin_dispatch::registry`
//!   directly (a much longer list, but with no rich arg specs).
//!
//! that meant the two shells exposed different commands for no
//! good reason, and rich `ArgKind`s (SelectFrom, OneOf, Text)
//! had to be duplicated. this module is the single source of
//! truth; both shells should call [`commands()`] at boot.
//!
//! when adding a new command:
//! - if it's a no-arg dispatch, just append to the
//!   `NO_ARG_COMMANDS` list at the bottom.
//! - if it needs a form, add a builder to `rich_commands()`
//!   above the no-arg loop. the builder name should match the
//!   server-side dispatch key.

use super::app::{AdminCommand, ArgKind, ArgSpec, CommandKind};

/// build the full seed command list.
///
/// rich-form commands are returned first (so they cluster at the
/// top of the palette), followed by every other registry entry
/// rendered as a no-arg admin dispatch. plus a few public
/// commands (e.g. `knock`) the wasm shell needs.
pub fn commands() -> Vec<AdminCommand> {
    let mut out: Vec<AdminCommand> = rich_commands();

    // append no-arg admin commands that don't have a rich form
    // yet. anything in `rich_commands()` above wins.
    for &(name, req, resp) in NO_ARG_COMMANDS {
        if out.iter().any(|c| c.name == name) {
            continue;
        }
        out.push(AdminCommand::admin_noargs(name, req, resp));
    }
    out
}

/// hand-written commands with full arg specs so the form picker
/// (and SelectFrom dropdowns) work. anything listed here
/// shadows the no-arg fallback below.
fn rich_commands() -> Vec<AdminCommand> {
    vec![
        knocks_accept_command(),
        knocks_reject_command(),
        knocks_delete_command(),
        users_get_command(),
        users_update_role_command(),
        users_delete_command(),
        users_restore_command(),
        users_generate_account_link_command(),
        knock_public_command(),
    ]
}

// =========================================================================
// rich-form command builders
// =========================================================================

fn role_choices() -> Vec<String> {
    vec![
        "viewer".to_string(),
        "member".to_string(),
        "admin".to_string(),
    ]
}

fn pick_pending_knock(name: &str) -> ArgSpec {
    ArgSpec {
        name: name.to_string(),
        kind: ArgKind::SelectFrom {
            source_command: "knocks_list".to_string(),
            data_path: String::new(),
            value_field: "id".to_string(),
            label_field: "username".to_string(),
        },
        required: true,
        help: Some("←/→ to pick a pending knock".to_string()),
    }
}

fn pick_user(name: &str, help: &str) -> ArgSpec {
    ArgSpec {
        name: name.to_string(),
        kind: ArgKind::SelectFrom {
            source_command: "users_list".to_string(),
            data_path: String::new(),
            value_field: "id".to_string(),
            label_field: "username".to_string(),
        },
        required: true,
        help: Some(help.to_string()),
    }
}

fn knocks_accept_command() -> AdminCommand {
    AdminCommand {
        name: "knocks_accept".to_string(),
        request_type: "KnocksAcceptRequest".to_string(),
        response_type: "KnockRequest".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            pick_pending_knock("knock_id"),
            ArgSpec {
                name: "username".to_string(),
                kind: ArgKind::Text {
                    placeholder: "(blank = use the username from the knock)".to_string(),
                },
                required: false,
                help: Some("optional override for the new user's name".to_string()),
            },
            ArgSpec {
                name: "user_id".to_string(),
                kind: ArgKind::SelectFrom {
                    source_command: "users_list".to_string(),
                    data_path: String::new(),
                    value_field: "id".to_string(),
                    label_field: "username".to_string(),
                },
                required: false,
                help: Some(
                    "(optional) link the knock to an existing user instead of creating one"
                        .to_string(),
                ),
            },
            ArgSpec {
                name: "role".to_string(),
                kind: ArgKind::OneOf {
                    choices: role_choices(),
                },
                required: true,
                help: Some("role for the new user (ignored if linking)".to_string()),
            },
        ],
    }
}

fn knocks_reject_command() -> AdminCommand {
    AdminCommand {
        name: "knocks_reject".to_string(),
        request_type: "KnocksRejectRequest".to_string(),
        response_type: "KnockRequest".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_pending_knock("knock_id")],
    }
}

fn knocks_delete_command() -> AdminCommand {
    AdminCommand {
        name: "knocks_delete".to_string(),
        request_type: "KnocksDeleteRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_pending_knock("knock_id")],
    }
}

fn users_get_command() -> AdminCommand {
    AdminCommand {
        name: "users_get".to_string(),
        request_type: "AdminUsersGetRequest".to_string(),
        response_type: "AdminUserSummary".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_user("user_id", "pick a user to inspect")],
    }
}

fn users_update_role_command() -> AdminCommand {
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

fn users_delete_command() -> AdminCommand {
    AdminCommand {
        name: "users_delete".to_string(),
        request_type: "AdminUsersDeleteRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_user("user_id", "pick a user to soft-delete")],
    }
}

fn users_restore_command() -> AdminCommand {
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

fn users_generate_account_link_command() -> AdminCommand {
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

fn knock_public_command() -> AdminCommand {
    AdminCommand {
        name: "knock".to_string(),
        request_type: "CreateKnockRequest".to_string(),
        response_type: "KnockRequest".to_string(),
        auth: "Public".to_string(),
        kind: CommandKind::Public {
            route: "/api/knock".to_string(),
            method: "POST".to_string(),
        },
        args: vec![
            ArgSpec {
                name: "node_id".to_string(),
                kind: ArgKind::HiddenLocalNodeId,
                required: true,
                help: None,
            },
            ArgSpec {
                name: "username".to_string(),
                kind: ArgKind::Text {
                    placeholder: "the username you'd like to use".to_string(),
                },
                required: true,
                help: Some("shown to the admin reviewing your knock".to_string()),
            },
            ArgSpec {
                name: "message".to_string(),
                kind: ArgKind::LongText {
                    placeholder: "(optional) why do you want access?".to_string(),
                },
                required: false,
                help: None,
            },
        ],
    }
}

// =========================================================================
// no-arg fallback list. mirrors `grimoire::admin_dispatch::registry`
// so both shells expose the same surface, plus a few public/untyped
// commands that aren't in the registry (e.g. `server_info`).
//
// keep entries in sync with `grimoire/src/admin_dispatch/registry.rs`.
// drift just means a command is missing from the palette — it'll
// still dispatch fine if you type the name in.
// =========================================================================

const NO_ARG_COMMANDS: &[(&str, &str, &str)] = &[
    // -- knocks --
    ("knocks_list", "EmptyRequest", "Vec<KnockRequest>"),
    ("knocks_list_all", "EmptyRequest", "Vec<KnockRequest>"),
    (
        "knocks_reject_all",
        "EmptyRequest",
        "KnocksRejectAllResponse",
    ),
    // -- users --
    ("users_list", "AdminUsersListRequest", "Vec<AdminUserSummary>"),
    ("users_hard_delete", "AdminUsersHardDeleteRequest", "EmptyResponse"),
    // -- invites --
    ("invites_list", "AdminInvitesListRequest", "Vec<AdminInviteInfo>"),
    (
        "invites_generate",
        "AdminInvitesGenerateRequest",
        "AdminInvitesGenerateResponse",
    ),
    ("invites_revoke", "AdminInvitesRevokeRequest", "EmptyResponse"),
    (
        "invites_revoke_all",
        "EmptyRequest",
        "AdminInvitesRevokeAllResponse",
    ),
    (
        "invites_update_role",
        "AdminInvitesUpdateRoleRequest",
        "EmptyResponse",
    ),
    // -- peers --
    ("peers_list_all", "AdminPeersListAllRequest", "Vec<AdminPeerSummary>"),
    (
        "peers_list_for_user",
        "AdminPeersListForUserRequest",
        "Vec<AdminPeerNodeSummary>",
    ),
    ("peers_remove", "AdminPeersRemoveRequest", "EmptyResponse"),
    ("peers_restore", "AdminPeersRestoreRequest", "EmptyResponse"),
    ("peers_allow", "AdminPeersAllowRequest", "AdminPeersAllowResponse"),
    // -- radio --
    ("radio_stations_list", "EmptyRequest", "Vec<RadioStation>"),
    ("radio_stations_get", "RadioStationsByIdRequest", "RadioStation"),
    ("radio_stations_create", "CreateStationRequest", "RadioStation"),
    ("radio_stations_update", "UpdateStationRequest", "RadioStation"),
    ("radio_stations_delete", "RadioStationsByIdRequest", "EmptyResponse"),
    (
        "radio_filters_list",
        "RadioStationByStationIdRequest",
        "Vec<StationFilter>",
    ),
    ("radio_filters_add", "RadioFiltersAddRequest", "StationFilter"),
    (
        "radio_filters_remove",
        "RadioFiltersRemoveRequest",
        "EmptyResponse",
    ),
    (
        "radio_seed_suggest",
        "RadioSeedSuggestRequest",
        "Vec<RadioSeedSuggestion>",
    ),
    ("radio_config_get", "EmptyRequest", "RadioConfigPayload"),
    ("radio_config_set", "RadioConfigPayload", "RadioConfigPayload"),
    (
        "radio_supervisor_status",
        "EmptyRequest",
        "RadioSupervisorStatusResponse",
    ),
    (
        "radio_supervisor_start",
        "RadioSupervisorStationRequest",
        "RadioSupervisorStatusResponse",
    ),
    (
        "radio_supervisor_stop",
        "RadioSupervisorStationRequest",
        "RadioSupervisorStatusResponse",
    ),
    (
        "radio_supervisor_restart",
        "RadioSupervisorStationRequest",
        "RadioSupervisorStatusResponse",
    ),
    (
        "radio_supervisor_skip_track",
        "RadioSupervisorStationRequest",
        "RadioSupervisorStatusResponse",
    ),
    ("radio_bumpers_list", "EmptyRequest", "Vec<RadioBumper>"),
    ("radio_bumpers_add", "RadioBumpersAddRequest", "RadioBumper"),
    ("radio_bumpers_remove", "RadioBumpersRemoveRequest", "EmptyResponse"),
    (
        "radio_bumpers_set_frequency",
        "RadioBumpersSetFrequencyRequest",
        "RadioBumper",
    ),
    // -- meta / public --
    // server_info isn't in the typed registry but the dispatcher
    // routes it to `offal::public::health::server_info()` and
    // returns a small json blob. handy quick-test command.
    ("server_info", "EmptyRequest", "serde_json::Value"),
];
