//! analytics command builders.

use crate::ratcore::app::{AdminCommand, ArgKind, ArgSpec, CommandKind};
use crate::ratcore::catalog::widgets::{limit_arg, offset_arg, pick_user};

pub(in crate::ratcore::catalog) fn top_songs() -> AdminCommand {
    AdminCommand {
        name: "analytics_top_songs".to_string(),
        request_type: "AnalyticsLimitRequest".to_string(),
        response_type: "Vec<TopSong>".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![limit_arg(20, "how many songs to return")],
    }
}

pub(in crate::ratcore::catalog) fn top_albums() -> AdminCommand {
    AdminCommand {
        name: "analytics_top_albums".to_string(),
        request_type: "AnalyticsLimitRequest".to_string(),
        response_type: "Vec<TopAlbum>".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![limit_arg(20, "how many albums to return")],
    }
}

pub(in crate::ratcore::catalog) fn top_artists() -> AdminCommand {
    AdminCommand {
        name: "analytics_top_artists".to_string(),
        request_type: "AnalyticsLimitRequest".to_string(),
        response_type: "Vec<TopArtist>".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![limit_arg(20, "how many artists to return")],
    }
}

pub(in crate::ratcore::catalog) fn user_stats() -> AdminCommand {
    AdminCommand {
        name: "analytics_user_stats".to_string(),
        request_type: "AnalyticsUserStatsRequest".to_string(),
        response_type: "UserStats".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_user("user_id", "pick a user to inspect stats for")],
    }
}

pub(in crate::ratcore::catalog) fn all_user_stats() -> AdminCommand {
    AdminCommand {
        name: "analytics_all_user_stats".to_string(),
        request_type: "AnalyticsLimitRequest".to_string(),
        response_type: "Vec<UserStats>".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![limit_arg(50, "how many users to return")],
    }
}

pub(in crate::ratcore::catalog) fn song_stats() -> AdminCommand {
    AdminCommand {
        name: "analytics_song_stats".to_string(),
        request_type: "AnalyticsSongStatsRequest".to_string(),
        response_type: "SongPlayAnalytics".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![ArgSpec {
            name: "song_id".to_string(),
            kind: ArgKind::Text {
                placeholder: "song id".to_string(),
            },
            required: true,
            help: Some("song id (uuid) to look up".to_string()),
        }],
    }
}

pub(in crate::ratcore::catalog) fn user_history() -> AdminCommand {
    AdminCommand {
        name: "analytics_user_history".to_string(),
        request_type: "AnalyticsUserHistoryRequest".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            pick_user("user_id", "pick a user to view listening history for"),
            limit_arg(50, "how many events to return"),
            offset_arg(),
        ],
    }
}

pub(in crate::ratcore::catalog) fn session() -> AdminCommand {
    AdminCommand {
        name: "analytics_session".to_string(),
        request_type: "AnalyticsSessionRequest".to_string(),
        response_type: "SessionSummary".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![ArgSpec {
            name: "session_id".to_string(),
            kind: ArgKind::Text {
                placeholder: "session id".to_string(),
            },
            required: true,
            help: Some("listening session id".to_string()),
        }],
    }
}

pub(in crate::ratcore::catalog) fn recent_listens() -> AdminCommand {
    AdminCommand {
        name: "analytics_recent_listens".to_string(),
        request_type: "AnalyticsFeedRequest".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![limit_arg(20, "how many recent listens"), offset_arg()],
    }
}

pub(in crate::ratcore::catalog) fn recent_favorites() -> AdminCommand {
    AdminCommand {
        name: "analytics_recent_favorites".to_string(),
        request_type: "AnalyticsFeedRequest".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![limit_arg(20, "how many recent favorites"), offset_arg()],
    }
}

pub(in crate::ratcore::catalog) fn recent_albums() -> AdminCommand {
    AdminCommand {
        name: "analytics_recent_albums".to_string(),
        request_type: "AnalyticsFeedRequest".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![limit_arg(20, "how many recent albums"), offset_arg()],
    }
}

pub(in crate::ratcore::catalog) fn feed() -> AdminCommand {
    AdminCommand {
        name: "analytics_feed".to_string(),
        request_type: "AnalyticsFeedRequest".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![limit_arg(20, "how many feed items"), offset_arg()],
    }
}

pub(in crate::ratcore::catalog) fn counts() -> AdminCommand {
    AdminCommand {
        name: "analytics_counts".to_string(),
        request_type: "AnalyticsCountsRequest".to_string(),
        response_type: "serde_json::Value".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            ArgSpec {
                name: "entity_type".to_string(),
                kind: ArgKind::OneOf {
                    choices: vec![
                        "song".to_string(),
                        "album".to_string(),
                        "artist".to_string(),
                    ],
                },
                required: true,
                help: Some("which kind of entity to count plays for".to_string()),
            },
            ArgSpec {
                name: "entity_id".to_string(),
                kind: ArgKind::Text {
                    placeholder: "entity id".to_string(),
                },
                required: true,
                help: Some("id of the entity".to_string()),
            },
        ],
    }
}
