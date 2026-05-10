//! invites command builders.

use crate::ratcore::app::{AdminCommand, ArgKind, ArgSpec, CommandKind};
use crate::ratcore::catalog::widgets::{pick_invite, role_choices};

pub(in crate::ratcore::catalog) fn list() -> AdminCommand {
    AdminCommand {
        name: "invites_list".to_string(),
        request_type: "AdminInvitesListRequest".to_string(),
        response_type: "Vec<AdminInviteInfo>".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![ArgSpec {
            name: "active_only".to_string(),
            kind: ArgKind::OptionalBool { default: None },
            required: false,
            help: Some("←/→ to cycle: unset = default (false)".to_string()),
        }],
    }
}

pub(in crate::ratcore::catalog) fn generate() -> AdminCommand {
    AdminCommand {
        name: "invites_generate".to_string(),
        request_type: "AdminInvitesGenerateRequest".to_string(),
        response_type: "AdminInvitesGenerateResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            ArgSpec {
                name: "role".to_string(),
                kind: ArgKind::OneOf {
                    choices: role_choices(),
                },
                required: true,
                help: Some("role granted to whoever redeems the invite".to_string()),
            },
            ArgSpec {
                name: "count".to_string(),
                kind: ArgKind::Number {
                    placeholder: "(blank = 1) how many invite codes to mint".to_string(),
                    signed: false,
                    min: Some(1),
                    max: Some(1000),
                },
                required: false,
                help: None,
            },
            ArgSpec {
                name: "word_count".to_string(),
                kind: ArgKind::Number {
                    placeholder: "(blank = default) words per code".to_string(),
                    signed: false,
                    min: Some(1),
                    max: Some(32),
                },
                required: false,
                help: None,
            },
            ArgSpec {
                name: "expires_hours".to_string(),
                kind: ArgKind::Number {
                    placeholder: "(blank = no expiry) hours until expiry".to_string(),
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

pub(in crate::ratcore::catalog) fn revoke() -> AdminCommand {
    AdminCommand {
        name: "invites_revoke".to_string(),
        request_type: "AdminInvitesRevokeRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![pick_invite("code", "pick an invite to revoke")],
    }
}

pub(in crate::ratcore::catalog) fn update_role() -> AdminCommand {
    AdminCommand {
        name: "invites_update_role".to_string(),
        request_type: "AdminInvitesUpdateRoleRequest".to_string(),
        response_type: "EmptyResponse".to_string(),
        auth: "Admin".to_string(),
        kind: CommandKind::Admin,
        args: vec![
            pick_invite("code", "pick an invite to re-role"),
            ArgSpec {
                name: "role".to_string(),
                kind: ArgKind::OneOf {
                    choices: role_choices(),
                },
                required: true,
                help: Some("new role for whoever redeems this invite".to_string()),
            },
        ],
    }
}
