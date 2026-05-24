//! library command builders.

use crate::ratcore::app::{AdminCommand, ArgKind, ArgSpec, CommandKind};
use crate::ratcore::catalog::widgets::path_arg;

pub(in crate::ratcore::catalog) fn scan() -> AdminCommand {
    AdminCommand {
        name: "library_scan".to_string(),
        request_type: "serde_json::Value".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            path_arg("directory path to scan for import jobs"),
            ArgSpec {
                name: "recursive".to_string(),
                kind: ArgKind::Bool { default: true },
                required: false,
                help: Some("scan subdirectories too".to_string()),
            },
            ArgSpec {
                name: "tags".to_string(),
                kind: ArgKind::Text {
                    placeholder: "(optional) comma-separated tags".to_string(),
                },
                required: false,
                help: Some("applies tags to this directory before enqueuing jobs".to_string()),
            },
        ],
    }
}
