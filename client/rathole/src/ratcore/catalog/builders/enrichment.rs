//! enrichment command builders.

use crate::ratcore::app::{AdminCommand, ArgKind, ArgSpec, CommandKind};

pub(in crate::ratcore::catalog) fn bulk_auto() -> AdminCommand {
    AdminCommand {
        name: "music_enrichment_bulk_auto".to_string(),
        request_type: "JsonValue".to_string(),
        response_type: "JsonValue".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            ArgSpec {
                name: "tag_ids".to_string(),
                kind: ArgKind::MultiSelectFrom {
                    source_command: "music_enrichment_tags".to_string(),
                    source_body: serde_json::json!({}),
                    body_from_fields: vec![],
                    data_path: "tags".to_string(),
                    value_field: "id".to_string(),
                    label_field: "name".to_string(),
                },
                required: true,
                help: Some("pick one or more tags to target".to_string()),
            },
            ArgSpec {
                name: "mode".to_string(),
                kind: ArgKind::OneOf {
                    choices: vec!["any".to_string(), "all".to_string()],
                },
                required: false,
                help: Some("any = match any selected tag, all = require every selected tag".to_string()),
            },
            ArgSpec {
                name: "force".to_string(),
                kind: ArgKind::OptionalBool { default: None },
                required: false,
                help: Some("force a rerun even when enrichment state exists".to_string()),
            },
            ArgSpec {
                name: "min_confidence".to_string(),
                kind: ArgKind::Number {
                    placeholder: "optional, e.g. 70".to_string(),
                    signed: false,
                    min: Some(0),
                    max: Some(100),
                },
                required: false,
                help: Some("optional minimum confidence for auto-confirm".to_string()),
            },
            ArgSpec {
                name: "min_gap".to_string(),
                kind: ArgKind::Number {
                    placeholder: "optional, e.g. 10".to_string(),
                    signed: false,
                    min: Some(0),
                    max: Some(100),
                },
                required: false,
                help: Some("optional minimum confidence gap for auto-confirm".to_string()),
            },
            ArgSpec {
                name: "priority".to_string(),
                kind: ArgKind::Number {
                    placeholder: "optional queue priority".to_string(),
                    signed: true,
                    min: None,
                    max: None,
                },
                required: false,
                help: Some("optional queue priority override".to_string()),
            },
        ],
    }
}
