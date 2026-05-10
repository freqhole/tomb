//! public (non-admin) command builders.

use crate::ratcore::app::{AdminCommand, ArgKind, ArgSpec, CommandKind};

pub(in crate::ratcore::catalog) fn knock() -> AdminCommand {
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
