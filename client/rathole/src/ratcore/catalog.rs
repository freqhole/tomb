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

use super::app::{ActionMenuOption, AdminCommand, ArgKind, ArgSpec, CommandKind};

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

/// per-list-command actions surfaced by the result-pane action menu.
/// every list-style command should have at least a `get` / `delete`
/// pair where it makes sense; commands with no entry here fall back
/// to the generic actions appended at the end of every list.
pub fn result_actions(command_name: &str) -> Vec<ActionMenuOption> {
    let opts: &[(&str, &str)] = match command_name {
        "users_list" => &[
            ("get", "users_get"),
            ("update role", "users_update_role"),
            ("delete (soft)", "users_delete"),
            ("delete (hard)", "users_hard_delete"),
            ("restore", "users_restore"),
            ("generate account link", "users_generate_account_link"),
        ],
        "knocks_list" | "knocks_list_all" => &[
            ("accept", "knocks_accept"),
            ("reject", "knocks_reject"),
            ("delete", "knocks_delete"),
        ],
        "invites_list" => &[
            ("revoke", "invites_revoke"),
            ("update role", "invites_update_role"),
        ],
        "peers_list_all" | "peers_list_for_user" => &[
            ("remove", "peers_remove"),
            ("restore", "peers_restore"),
        ],
        "radio_stations_list" => &[
            ("get", "radio_stations_get"),
            ("update", "radio_stations_update"),
            ("delete", "radio_stations_delete"),
            ("start", "radio_supervisor_start"),
            ("stop", "radio_supervisor_stop"),
            ("restart", "radio_supervisor_restart"),
            ("skip track", "radio_supervisor_skip_track"),
            ("list filters", "radio_filters_list"),
        ],
        "radio_filters_list" => &[("remove", "radio_filters_remove")],
        "radio_bumpers_list" => &[
            ("remove", "radio_bumpers_remove"),
            ("set frequency", "radio_bumpers_set_frequency"),
        ],
        _ => &[],
    };
    let mut out: Vec<ActionMenuOption> = opts
        .iter()
        .map(|(label, target)| ActionMenuOption {
            label: (*label).to_string(),
            target_command: (*target).to_string(),
        })
        .collect();
    // generic fallback: every row, regardless of list, can at least
    // be inspected. the special target name is recognised by the
    // shells' action-menu key handler and rendered as a json popup
    // instead of opening a form.
    out.push(ActionMenuOption {
        label: "view full row".to_string(),
        target_command: "__view_row__".to_string(),
    });
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
        users_list_command(),
        users_get_command(),
        users_update_role_command(),
        users_delete_command(),
        users_hard_delete_command(),
        users_restore_command(),
        users_generate_account_link_command(),
        invites_list_command(),
        invites_generate_command(),
        invites_revoke_command(),
        invites_update_role_command(),
        peers_list_all_command(),
        peers_list_for_user_command(),
        peers_remove_command(),
        peers_restore_command(),
        peers_allow_command(),
        radio_stations_get_command(),
        radio_stations_create_command(),
        radio_stations_update_command(),
        radio_stations_delete_command(),
        radio_supervisor_start_command(),
        radio_supervisor_stop_command(),
        radio_supervisor_restart_command(),
        radio_supervisor_skip_track_command(),
        radio_filters_list_command(),
        radio_filters_add_command(),
        radio_filters_remove_command(),
        radio_bumpers_add_command(),
        radio_bumpers_remove_command(),
        radio_bumpers_set_frequency_command(),
        radio_seed_suggest_command(),
        radio_config_set_command(),
        knock_public_command(),
    ]
}

// =========================================================================
// rich-form command builders
// =========================================================================

/// shorthand for the most common SelectFrom shape: top-level array,
/// no source body, no sibling deps.
fn select_from(source_command: &str, value_field: &str, label_field: &str) -> ArgKind {
    ArgKind::SelectFrom {
        source_command: source_command.to_string(),
        source_body: serde_json::json!({}),
        body_from_fields: vec![],
        data_path: String::new(),
        value_field: value_field.to_string(),
        label_field: label_field.to_string(),
    }
}

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
        kind: select_from("knocks_list", "id", "username"),
        required: true,
        help: Some("←/→ to pick a pending knock".to_string()),
    }
}

fn pick_user(name: &str, help: &str) -> ArgSpec {
    ArgSpec {
        name: name.to_string(),
        kind: select_from("users_list", "id", "username"),
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
                kind: select_from("users_list", "id", "username"),
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

fn users_list_command() -> AdminCommand {
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
                    placeholder: "(blank = no filter) e.g. root, admin, member, viewer"
                        .to_string(),
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

fn users_hard_delete_command() -> AdminCommand {
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

// =========================================================================
// invites
// =========================================================================

fn pick_invite(name: &str, help: &str) -> ArgSpec {
    ArgSpec {
        name: name.to_string(),
        kind: select_from("invites_list", "code", "code"),
        required: true,
        help: Some(help.to_string()),
    }
}

fn invites_list_command() -> AdminCommand {
    AdminCommand {
        name: "invites_list".to_string(),
        request_type: "AdminInvitesListRequest".to_string(),
        response_type: "Vec<AdminInviteInfo>".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![ArgSpec {
            name: "active_only".to_string(),
            kind: ArgKind::OptionalBool { default: None },
            required: false,
            help: Some("←/→ to cycle: unset = default (false)".to_string()),
        }],
    }
}

fn invites_generate_command() -> AdminCommand {
    AdminCommand {
        name: "invites_generate".to_string(),
        request_type: "AdminInvitesGenerateRequest".to_string(),
        response_type: "AdminInvitesGenerateResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            ArgSpec {
                name: "role".to_string(),
                kind: ArgKind::OneOf {
                    choices: role_choices(),
                },
                required: true,
                help: Some("role granted to whoever redeems the invite".to_string()),
            },
            ArgSpec {
                name: "count".to_string(),
                kind: ArgKind::Number {
                    placeholder: "(blank = 1) how many invite codes to mint".to_string(),
                    signed: false,
                    min: Some(1),
                    max: Some(1000),
                },
                required: false,
                help: None,
            },
            ArgSpec {
                name: "word_count".to_string(),
                kind: ArgKind::Number {
                    placeholder: "(blank = default) words per code".to_string(),
                    signed: false,
                    min: Some(1),
                    max: Some(32),
                },
                required: false,
                help: None,
            },
            ArgSpec {
                name: "expires_hours".to_string(),
                kind: ArgKind::Number {
                    placeholder: "(blank = no expiry) hours until expiry".to_string(),
                    signed: false,
                    min: Some(1),
                    max: None,
                },
                required: false,
                help: None,
            },
        ],
    }
}

fn invites_revoke_command() -> AdminCommand {
    AdminCommand {
        name: "invites_revoke".to_string(),
        request_type: "AdminInvitesRevokeRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_invite("code", "pick an invite to revoke")],
    }
}

fn invites_update_role_command() -> AdminCommand {
    AdminCommand {
        name: "invites_update_role".to_string(),
        request_type: "AdminInvitesUpdateRoleRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            pick_invite("code", "pick an invite to re-role"),
            ArgSpec {
                name: "role".to_string(),
                kind: ArgKind::OneOf {
                    choices: role_choices(),
                },
                required: true,
                help: Some("new role for whoever redeems this invite".to_string()),
            },
        ],
    }
}

// =========================================================================
// peers
// =========================================================================

/// peer picker: a single SelectFrom over `peers_list_all` whose rows
/// carry `user_id`, `node_id`, and `username`. value=user_id so the
/// picker can drive request fields named `user_id`; commands that
/// also need `node_id` should pair this with a `mirror_peer_node`
/// field that pulls `node_id` off the same selected row.
fn pick_peer(name: &str, help: &str) -> ArgSpec {
    ArgSpec {
        name: name.to_string(),
        kind: select_from("peers_list_all", "user_id", "username"),
        required: true,
        help: Some(help.to_string()),
    }
}

/// auto-derived `node_id` companion for `pick_peer`. picks up the
/// node id off whichever row is currently selected in `from_field`.
fn mirror_peer_node(name: &str, from_field: &str) -> ArgSpec {
    ArgSpec {
        name: name.to_string(),
        kind: ArgKind::Mirror {
            from_field: from_field.to_string(),
            source_row_field: "node_id".to_string(),
        },
        required: true,
        help: None,
    }
}

fn peers_list_all_command() -> AdminCommand {
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

fn peers_list_for_user_command() -> AdminCommand {
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

fn peers_remove_command() -> AdminCommand {
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

fn peers_restore_command() -> AdminCommand {
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

fn peers_allow_command() -> AdminCommand {
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

// =========================================================================
// radio: stations
// =========================================================================

fn pick_station(name: &str, help: &str) -> ArgSpec {
    ArgSpec {
        name: name.to_string(),
        kind: select_from("radio_stations_list", "id", "name"),
        required: true,
        help: Some(help.to_string()),
    }
}

fn radio_stations_get_command() -> AdminCommand {
    AdminCommand {
        name: "radio_stations_get".to_string(),
        request_type: "RadioStationsByIdRequest".to_string(),
        response_type: "RadioStation".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_station("id", "pick a station to inspect")],
    }
}

fn radio_stations_create_command() -> AdminCommand {
    AdminCommand {
        name: "radio_stations_create".to_string(),
        request_type: "CreateStationRequest".to_string(),
        response_type: "RadioStation".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            ArgSpec {
                name: "name".to_string(),
                kind: ArgKind::Text {
                    placeholder: "station name".to_string(),
                },
                required: true,
                help: None,
            },
            ArgSpec {
                name: "description".to_string(),
                kind: ArgKind::Text {
                    placeholder: "(optional) description".to_string(),
                },
                required: false,
                help: None,
            },
            ArgSpec {
                name: "is_public".to_string(),
                kind: ArgKind::Bool { default: false },
                required: true,
                help: Some("public stations are reachable without auth".to_string()),
            },
            ArgSpec {
                name: "is_enabled".to_string(),
                kind: ArgKind::Bool { default: true },
                required: true,
                help: Some("disabled stations won't be served".to_string()),
            },
            ArgSpec {
                name: "codec".to_string(),
                kind: ArgKind::Text {
                    placeholder: "(blank = default) e.g. mp3, ogg".to_string(),
                },
                required: false,
                help: None,
            },
            ArgSpec {
                name: "play_mode".to_string(),
                kind: ArgKind::Text {
                    placeholder: "(blank = shuffle) e.g. shuffle, sequential".to_string(),
                },
                required: false,
                help: None,
            },
            ArgSpec {
                name: "encode_args".to_string(),
                kind: ArgKind::Text {
                    placeholder: "(blank = default) ffmpeg encode args".to_string(),
                },
                required: false,
                help: None,
            },
            ArgSpec {
                name: "timeline_only_mode".to_string(),
                kind: ArgKind::Bool { default: false },
                required: true,
                help: Some(
                    "true = serve only timeline control messages, no audio stream".to_string(),
                ),
            },
        ],
    }
}

fn radio_stations_update_command() -> AdminCommand {
    // UpdateStationRequest has many optional fields; expose the
    // common ones so an operator can tweak metadata without
    // hand-crafting json. blanks drop the field at submit time.
    AdminCommand {
        name: "radio_stations_update".to_string(),
        request_type: "UpdateStationRequest".to_string(),
        response_type: "RadioStation".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            pick_station("id", "pick a station to update"),
            ArgSpec {
                name: "name".to_string(),
                kind: ArgKind::Text {
                    placeholder: "(blank = leave alone) new station name".to_string(),
                },
                required: false,
                help: None,
            },
            ArgSpec {
                name: "description".to_string(),
                kind: ArgKind::Text {
                    placeholder: "(blank = leave alone) description".to_string(),
                },
                required: false,
                help: None,
            },
            ArgSpec {
                name: "codec".to_string(),
                kind: ArgKind::Text {
                    placeholder: "(blank = leave alone) e.g. mp3, ogg".to_string(),
                },
                required: false,
                help: None,
            },
            ArgSpec {
                name: "play_mode".to_string(),
                kind: ArgKind::Text {
                    placeholder: "(blank = leave alone) e.g. shuffle, sequential".to_string(),
                },
                required: false,
                help: None,
            },
            ArgSpec {
                name: "encode_args".to_string(),
                kind: ArgKind::Text {
                    placeholder: "(blank = leave alone) ffmpeg encode args".to_string(),
                },
                required: false,
                help: None,
            },
            ArgSpec {
                name: "is_public".to_string(),
                kind: ArgKind::OptionalBool { default: None },
                required: false,
                help: Some("←/→ to cycle: unset = leave alone".to_string()),
            },
            ArgSpec {
                name: "is_enabled".to_string(),
                kind: ArgKind::OptionalBool { default: None },
                required: false,
                help: Some("←/→ to cycle: unset = leave alone".to_string()),
            },
            ArgSpec {
                name: "timeline_only_mode".to_string(),
                kind: ArgKind::OptionalBool { default: None },
                required: false,
                help: Some("←/→ to cycle: unset = leave alone".to_string()),
            },
        ],
    }
}

fn radio_stations_delete_command() -> AdminCommand {
    AdminCommand {
        name: "radio_stations_delete".to_string(),
        request_type: "RadioStationsByIdRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_station("id", "pick a station to delete")],
    }
}

// =========================================================================
// radio: supervisor
// =========================================================================

fn supervisor_station_args(help: &str) -> Vec<ArgSpec> {
    vec![ArgSpec {
        name: "station_id".to_string(),
        kind: select_from("radio_stations_list", "id", "name"),
        required: true,
        help: Some(help.to_string()),
    }]
}

fn radio_supervisor_start_command() -> AdminCommand {
    AdminCommand {
        name: "radio_supervisor_start".to_string(),
        request_type: "RadioSupervisorStationRequest".to_string(),
        response_type: "RadioSupervisorStatusResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: supervisor_station_args("pick a station to start"),
    }
}

fn radio_supervisor_stop_command() -> AdminCommand {
    AdminCommand {
        name: "radio_supervisor_stop".to_string(),
        request_type: "RadioSupervisorStationRequest".to_string(),
        response_type: "RadioSupervisorStatusResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: supervisor_station_args("pick a station to stop"),
    }
}

fn radio_supervisor_restart_command() -> AdminCommand {
    AdminCommand {
        name: "radio_supervisor_restart".to_string(),
        request_type: "RadioSupervisorStationRequest".to_string(),
        response_type: "RadioSupervisorStatusResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: supervisor_station_args("pick a station to restart"),
    }
}

fn radio_supervisor_skip_track_command() -> AdminCommand {
    AdminCommand {
        name: "radio_supervisor_skip_track".to_string(),
        request_type: "RadioSupervisorStationRequest".to_string(),
        response_type: "RadioSupervisorStatusResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: supervisor_station_args("pick a station to skip the current track on"),
    }
}

// =========================================================================
// radio: filters
// =========================================================================

fn radio_filters_list_command() -> AdminCommand {
    AdminCommand {
        name: "radio_filters_list".to_string(),
        request_type: "RadioStationByStationIdRequest".to_string(),
        response_type: "Vec<StationFilter>".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_station("station_id", "pick a station to list filters for")],
    }
}

fn radio_filters_add_command() -> AdminCommand {
    AdminCommand {
        name: "radio_filters_add".to_string(),
        request_type: "RadioFiltersAddRequest".to_string(),
        response_type: "StationFilter".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            pick_station("station_id", "pick a station to add a filter to"),
            ArgSpec {
                name: "filter_type".to_string(),
                kind: ArgKind::OneOf {
                    choices: vec![
                        "artist".to_string(),
                        "album".to_string(),
                        "song".to_string(),
                        "genre".to_string(),
                        "tag".to_string(),
                    ],
                },
                required: true,
                help: Some("what kind of thing the filter matches".to_string()),
            },
            ArgSpec {
                name: "filter_value".to_string(),
                kind: ArgKind::Text {
                    placeholder: "id or value to match".to_string(),
                },
                required: true,
                help: None,
            },
            ArgSpec {
                name: "mode".to_string(),
                kind: ArgKind::OneOf {
                    choices: vec!["include".to_string(), "exclude".to_string()],
                },
                required: true,
                help: Some("include or exclude matches".to_string()),
            },
        ],
    }
}

fn radio_filters_remove_command() -> AdminCommand {
    AdminCommand {
        name: "radio_filters_remove".to_string(),
        request_type: "RadioFiltersRemoveRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            pick_station("station_id", "pick the station the filter belongs to"),
            ArgSpec {
                name: "filter_id".to_string(),
                kind: ArgKind::SelectFrom {
                    source_command: "radio_filters_list".to_string(),
                    source_body: serde_json::json!({}),
                    body_from_fields: vec![(
                        "station_id".to_string(),
                        "station_id".to_string(),
                    )],
                    data_path: String::new(),
                    value_field: "id".to_string(),
                    label_field: "filter_value".to_string(),
                },
                required: true,
                help: Some("pick the filter to remove".to_string()),
            },
        ],
    }
}

// =========================================================================
// radio: bumpers
// =========================================================================

fn pick_bumper(name: &str, help: &str) -> ArgSpec {
    ArgSpec {
        name: name.to_string(),
        kind: select_from("radio_bumpers_list", "id", "label"),
        required: true,
        help: Some(help.to_string()),
    }
}

fn radio_bumpers_add_command() -> AdminCommand {
    AdminCommand {
        name: "radio_bumpers_add".to_string(),
        request_type: "RadioBumpersAddRequest".to_string(),
        response_type: "RadioBumper".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            pick_station("station_id", "pick a station for this bumper"),
            ArgSpec {
                name: "song_id".to_string(),
                kind: ArgKind::Text {
                    placeholder: "song id to use as the bumper".to_string(),
                },
                required: true,
                help: None,
            },
            ArgSpec {
                name: "label".to_string(),
                kind: ArgKind::Text {
                    placeholder: "human-readable label for the bumper".to_string(),
                },
                required: true,
                help: None,
            },
            ArgSpec {
                name: "weight".to_string(),
                kind: ArgKind::Number {
                    placeholder: "(blank = default) selection weight".to_string(),
                    signed: true,
                    min: None,
                    max: None,
                },
                required: false,
                help: None,
            },
        ],
    }
}

fn radio_bumpers_remove_command() -> AdminCommand {
    AdminCommand {
        name: "radio_bumpers_remove".to_string(),
        request_type: "RadioBumpersRemoveRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_bumper("bumper_id", "pick a bumper to remove")],
    }
}

fn radio_bumpers_set_frequency_command() -> AdminCommand {
    AdminCommand {
        name: "radio_bumpers_set_frequency".to_string(),
        request_type: "RadioBumpersSetFrequencyRequest".to_string(),
        response_type: "RadioBumper".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            pick_station("station_id", "pick a station"),
            ArgSpec {
                name: "frequency_seconds".to_string(),
                kind: ArgKind::Number {
                    placeholder: "(blank = clear) seconds between bumpers".to_string(),
                    signed: false,
                    min: Some(1),
                    max: None,
                },
                required: false,
                help: None,
            },
        ],
    }
}

fn radio_seed_suggest_command() -> AdminCommand {
    AdminCommand {
        name: "radio_seed_suggest".to_string(),
        request_type: "RadioSeedSuggestRequest".to_string(),
        response_type: "Vec<RadioSeedSuggestion>".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_station("station_id", "pick a station to suggest seeds for")],
    }
}

fn radio_config_set_command() -> AdminCommand {
    // node-wide [radio] block. ffmpeg_available is server-derived
    // and ignored on input, so we only expose the two writable fields.
    AdminCommand {
        name: "radio_config_set".to_string(),
        request_type: "RadioConfigPayload".to_string(),
        response_type: "RadioConfigPayload".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            ArgSpec {
                name: "enabled".to_string(),
                kind: ArgKind::Bool { default: true },
                required: true,
                help: Some("master switch for the broadcaster".to_string()),
            },
            ArgSpec {
                name: "encode_args".to_string(),
                kind: ArgKind::Text {
                    placeholder: "ffmpeg encoder template, e.g. -i {input} -f mp3 pipe:1"
                        .to_string(),
                },
                required: true,
                help: Some("{input} placeholder; output to pipe:1".to_string()),
            },
            // ffmpeg_available is server-derived; send a dummy false
            // so the payload deserializes. server overrides it.
            ArgSpec {
                name: "ffmpeg_available".to_string(),
                kind: ArgKind::Bool { default: false },
                required: true,
                help: Some("ignored by the server (set to anything)".to_string()),
            },
        ],
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
