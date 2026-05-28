//! library command builders.

use crate::ratcore::app::{AdminCommand, ArgKind, ArgSpec, CommandKind};
use crate::ratcore::catalog::widgets::{path_arg, select_from};

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

pub(in crate::ratcore::catalog) fn list_directories() -> AdminCommand {
    AdminCommand {
        name: "library_list_directories".to_string(),
        request_type: "EmptyRequest".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![],
    }
}

pub(in crate::ratcore::catalog) fn remove_directory() -> AdminCommand {
    AdminCommand {
        name: "library_remove_directory".to_string(),
        request_type: "serde_json::Value".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![ArgSpec {
            name: "path".to_string(),
            kind: select_from("library_list_directories", "path", "path"),
            required: true,
            help: Some("select directory to remove from tracking".to_string()),
        }],
    }
}

pub(in crate::ratcore::catalog) fn move_directory() -> AdminCommand {
    AdminCommand {
        name: "library_move_directory".to_string(),
        request_type: "serde_json::Value".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            ArgSpec {
                name: "old_path".to_string(),
                kind: select_from("library_list_directories", "path", "path"),
                required: true,
                help: Some("select directory to move/relocate".to_string()),
            },
            path_arg("new path (where the files moved to on disk)"),
            ArgSpec {
                name: "dry_run".to_string(),
                kind: ArgKind::Bool { default: false },
                required: false,
                help: Some("preview changes without applying them".to_string()),
            },
        ],
    }
}
