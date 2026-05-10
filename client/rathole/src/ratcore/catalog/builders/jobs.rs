//! jobs command builders.

use crate::ratcore::app::{AdminCommand, ArgKind, ArgSpec, CommandKind};
use crate::ratcore::catalog::widgets::{limit_arg, offset_arg};

pub(in crate::ratcore::catalog) fn list() -> AdminCommand {
    AdminCommand {
        name: "jobs_list".to_string(),
        request_type: "JobsListRequest".to_string(),
        response_type: "Vec<Job>".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            ArgSpec {
                name: "session_id".to_string(),
                kind: ArgKind::Text {
                    placeholder: "(blank = all sessions)".to_string(),
                },
                required: false,
                help: Some("filter jobs by session id".to_string()),
            },
            limit_arg(100, "how many jobs to return"),
            offset_arg(),
        ],
    }
}
