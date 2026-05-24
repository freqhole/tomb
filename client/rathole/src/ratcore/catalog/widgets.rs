//! shared arg-spec widgets used by per-domain command builders.
//!
//! kept here so each `builders/<x>.rs` doesn't redeclare the same
//! `select_from(...)` helper or `pick_user` factory.

use crate::ratcore::app::{ArgKind, ArgSpec};

/// shorthand for the most common SelectFrom shape: top-level array,
/// no source body, no sibling deps.
pub(super) fn select_from(source_command: &str, value_field: &str, label_field: &str) -> ArgKind {
    ArgKind::SelectFrom {
        source_command: source_command.to_string(),
        source_body: serde_json::json!({}),
        body_from_fields: vec![],
        data_path: String::new(),
        value_field: value_field.to_string(),
        label_field: label_field.to_string(),
    }
}

pub(super) fn role_choices() -> Vec<String> {
    vec![
        "viewer".to_string(),
        "member".to_string(),
        "admin".to_string(),
    ]
}

pub(super) fn pick_pending_knock(name: &str) -> ArgSpec {
    ArgSpec {
        name: name.to_string(),
        kind: select_from("knocks_list", "id", "username"),
        required: true,
        help: Some("←/→ to pick a pending knock".to_string()),
    }
}

pub(super) fn pick_user(name: &str, help: &str) -> ArgSpec {
    ArgSpec {
        name: name.to_string(),
        kind: select_from("users_list_assignable", "id", "username"),
        required: true,
        help: Some(help.to_string()),
    }
}

pub(super) fn pick_user_peer_node(name: &str, user_field_name: &str, help: &str) -> ArgSpec {
    ArgSpec {
        name: name.to_string(),
        kind: ArgKind::SelectFrom {
            source_command: "peers_list_for_user".to_string(),
            source_body: serde_json::json!({}),
            body_from_fields: vec![("user_id".to_string(), user_field_name.to_string())],
            data_path: String::new(),
            value_field: "node_id".to_string(),
            label_field: "node_id".to_string(),
        },
        required: true,
        help: Some(help.to_string()),
    }
}

pub(super) fn pick_invite(name: &str, help: &str) -> ArgSpec {
    ArgSpec {
        name: name.to_string(),
        kind: select_from("invites_list", "code", "code"),
        required: true,
        help: Some(help.to_string()),
    }
}

/// peer picker: a single SelectFrom over `peers_list_all` whose rows
/// carry `user_id`, `node_id`, and `username`. value=user_id so the
/// picker can drive request fields named `user_id`; commands that
/// also need `node_id` should pair this with a `mirror_peer_node`
/// field that pulls `node_id` off the same selected row.
pub(super) fn pick_peer(name: &str, help: &str) -> ArgSpec {
    ArgSpec {
        name: name.to_string(),
        kind: select_from("peers_list_all", "user_id", "username"),
        required: true,
        help: Some(help.to_string()),
    }
}

/// auto-derived `node_id` companion for `pick_peer`. picks up the
/// node id off whichever row is currently selected in `from_field`.
pub(super) fn mirror_peer_node(name: &str, from_field: &str) -> ArgSpec {
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

pub(super) fn pick_station(name: &str, help: &str) -> ArgSpec {
    ArgSpec {
        name: name.to_string(),
        kind: select_from("radio_stations_list", "id", "name"),
        required: true,
        help: Some(help.to_string()),
    }
}

pub(super) fn supervisor_station_args(help: &str) -> Vec<ArgSpec> {
    vec![ArgSpec {
        name: "station_id".to_string(),
        kind: select_from("radio_stations_list", "id", "name"),
        required: true,
        help: Some(help.to_string()),
    }]
}

pub(super) fn pick_bumper(name: &str, help: &str) -> ArgSpec {
    ArgSpec {
        name: name.to_string(),
        kind: select_from("radio_bumpers_list", "id", "label"),
        required: true,
        help: Some(help.to_string()),
    }
}

pub(super) fn dry_run_arg() -> ArgSpec {
    ArgSpec {
        name: "dry_run".to_string(),
        kind: ArgKind::Bool { default: false },
        required: false,
        help: Some("preview without deleting".to_string()),
    }
}

pub(super) fn limit_arg(default: i64, help: &str) -> ArgSpec {
    ArgSpec {
        name: "limit".to_string(),
        kind: ArgKind::Number {
            placeholder: format!("default: {}", default),
            signed: false,
            min: Some(1),
            max: None,
        },
        required: false,
        help: Some(help.to_string()),
    }
}

pub(super) fn offset_arg() -> ArgSpec {
    ArgSpec {
        name: "offset".to_string(),
        kind: ArgKind::Number {
            placeholder: "default: 0".to_string(),
            signed: false,
            min: Some(0),
            max: None,
        },
        required: false,
        help: Some("pagination offset".to_string()),
    }
}

pub(super) fn path_arg(help: &str) -> ArgSpec {
    ArgSpec {
        name: "path".to_string(),
        kind: ArgKind::Text {
            placeholder: "/absolute/or/relative/path".to_string(),
        },
        required: true,
        help: Some(help.to_string()),
    }
}

pub(super) fn tags_arg(help: &str) -> ArgSpec {
    ArgSpec {
        name: "tags".to_string(),
        kind: ArgKind::Text {
            placeholder: "tag1,tag2,tag3".to_string(),
        },
        required: true,
        help: Some(help.to_string()),
    }
}
