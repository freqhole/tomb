//! dir_tags command builders.

use crate::ratcore::app::{AdminCommand, CommandKind};
use crate::ratcore::catalog::widgets::{path_arg, tags_arg};

pub(in crate::ratcore::catalog) fn list() -> AdminCommand {
    AdminCommand {
        name: "dir_tags_list".to_string(),
        request_type: "DirTagsListRequest".to_string(),
        response_type: "Vec<DirectoryTagRule>".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![path_arg("show tag rules covering this path")],
    }
}

pub(in crate::ratcore::catalog) fn add() -> AdminCommand {
    AdminCommand {
        name: "dir_tags_add".to_string(),
        request_type: "DirTagsAddRequest".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            path_arg("directory path the rule applies to"),
            tags_arg("comma-separated tag names to attach"),
        ],
    }
}

pub(in crate::ratcore::catalog) fn remove() -> AdminCommand {
    AdminCommand {
        name: "dir_tags_remove".to_string(),
        request_type: "DirTagsRemoveRequest".to_string(),
        response_type: "u64".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            path_arg("directory path the rule lives on"),
            tags_arg("comma-separated tag names to remove from the rule"),
        ],
    }
}

pub(in crate::ratcore::catalog) fn clear() -> AdminCommand {
    AdminCommand {
        name: "dir_tags_clear".to_string(),
        request_type: "DirTagsClearRequest".to_string(),
        response_type: "u64".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![path_arg("clear all tag rules at this directory")],
    }
}

pub(in crate::ratcore::catalog) fn strip() -> AdminCommand {
    AdminCommand {
        name: "dir_tags_strip".to_string(),
        request_type: "DirTagsStripRequest".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            path_arg("directory path whose songs will lose tags"),
            tags_arg("comma-separated tag names to strip from songs under this path"),
        ],
    }
}
