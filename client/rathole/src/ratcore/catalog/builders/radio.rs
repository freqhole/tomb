//! radio command builders (stations / supervisor / filters / bumpers / config / seed).

use crate::ratcore::app::{AdminCommand, ArgKind, ArgSpec, CommandKind};
use crate::ratcore::catalog::widgets::{pick_bumper, pick_station, supervisor_station_args};

// -- stations --

pub(in crate::ratcore::catalog) fn stations_get() -> AdminCommand {
    AdminCommand {
        name: "radio_stations_get".to_string(),
        request_type: "RadioStationsByIdRequest".to_string(),
        response_type: "RadioStation".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_station("id", "pick a station to inspect")],
    }
}

pub(in crate::ratcore::catalog) fn stations_create() -> AdminCommand {
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

pub(in crate::ratcore::catalog) fn stations_update() -> AdminCommand {
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

pub(in crate::ratcore::catalog) fn stations_delete() -> AdminCommand {
    AdminCommand {
        name: "radio_stations_delete".to_string(),
        request_type: "RadioStationsByIdRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_station("id", "pick a station to delete")],
    }
}

// -- supervisor --

pub(in crate::ratcore::catalog) fn supervisor_start() -> AdminCommand {
    AdminCommand {
        name: "radio_supervisor_start".to_string(),
        request_type: "RadioSupervisorStationRequest".to_string(),
        response_type: "RadioSupervisorStatusResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: supervisor_station_args("pick a station to start"),
    }
}

pub(in crate::ratcore::catalog) fn supervisor_stop() -> AdminCommand {
    AdminCommand {
        name: "radio_supervisor_stop".to_string(),
        request_type: "RadioSupervisorStationRequest".to_string(),
        response_type: "RadioSupervisorStatusResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: supervisor_station_args("pick a station to stop"),
    }
}

pub(in crate::ratcore::catalog) fn supervisor_restart() -> AdminCommand {
    AdminCommand {
        name: "radio_supervisor_restart".to_string(),
        request_type: "RadioSupervisorStationRequest".to_string(),
        response_type: "RadioSupervisorStatusResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: supervisor_station_args("pick a station to restart"),
    }
}

pub(in crate::ratcore::catalog) fn supervisor_skip_track() -> AdminCommand {
    AdminCommand {
        name: "radio_supervisor_skip_track".to_string(),
        request_type: "RadioSupervisorStationRequest".to_string(),
        response_type: "RadioSupervisorStatusResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: supervisor_station_args("pick a station to skip the current track on"),
    }
}

// -- filters --

pub(in crate::ratcore::catalog) fn filters_list() -> AdminCommand {
    AdminCommand {
        name: "radio_filters_list".to_string(),
        request_type: "RadioStationByStationIdRequest".to_string(),
        response_type: "Vec<StationFilter>".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_station(
            "station_id",
            "pick a station to list filters for",
        )],
    }
}

pub(in crate::ratcore::catalog) fn filters_add() -> AdminCommand {
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

pub(in crate::ratcore::catalog) fn filters_remove() -> AdminCommand {
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
                    body_from_fields: vec![("station_id".to_string(), "station_id".to_string())],
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

// -- bumpers --

pub(in crate::ratcore::catalog) fn bumpers_add() -> AdminCommand {
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

pub(in crate::ratcore::catalog) fn bumpers_remove() -> AdminCommand {
    AdminCommand {
        name: "radio_bumpers_remove".to_string(),
        request_type: "RadioBumpersRemoveRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_bumper("bumper_id", "pick a bumper to remove")],
    }
}

pub(in crate::ratcore::catalog) fn bumpers_set_frequency() -> AdminCommand {
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

// -- seed / config --

pub(in crate::ratcore::catalog) fn seed_suggest() -> AdminCommand {
    AdminCommand {
        name: "radio_seed_suggest".to_string(),
        request_type: "RadioSeedSuggestRequest".to_string(),
        response_type: "Vec<RadioSeedSuggestion>".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_station(
            "station_id",
            "pick a station to suggest seeds for",
        )],
    }
}

pub(in crate::ratcore::catalog) fn config_set() -> AdminCommand {
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
