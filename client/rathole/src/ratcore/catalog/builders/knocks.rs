//! knocks command builders.

use crate::ratcore::app::{AdminCommand, ArgKind, ArgSpec, CommandKind};
use crate::ratcore::catalog::widgets::{pick_pending_knock, role_choices};

pub(in crate::ratcore::catalog) fn accept() -> AdminCommand {
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
                help: Some(
                    "type a username. if it already exists the knock is linked to that user; otherwise a new user is created."
                        .to_string(),
                ),
            },
            ArgSpec {
                name: "role".to_string(),
                kind: ArgKind::OneOf {
                    choices: role_choices(),
                },
                required: true,
                help: Some("role for the new user (ignored when linking to an existing user)".to_string()),
            },
        ],
    }
}

pub(in crate::ratcore::catalog) fn reject() -> AdminCommand {
    AdminCommand {
        name: "knocks_reject".to_string(),
        request_type: "KnocksRejectRequest".to_string(),
        response_type: "KnockRequest".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_pending_knock("knock_id")],
    }
}

pub(in crate::ratcore::catalog) fn delete() -> AdminCommand {
    AdminCommand {
        name: "knocks_delete".to_string(),
        request_type: "KnocksDeleteRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_pending_knock("knock_id")],
    }
}
