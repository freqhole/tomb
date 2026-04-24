//! registry of admin commands carried over the `freqhole-admin/1` ALPN.
//!
//! consumed by:
//! - the typescript codegen tool, which emits `admin_commands.ts` with
//!   per-command zod schemas wired to the same names the rust dispatcher
//!   matches against
//! - any future runtime that needs to enumerate the surface (docs,
//!   debug introspection)
//!
//! every entry references rust type names registered with the zod schema
//! generator. unknown type names will fail codegen with a clear message,
//! mirroring how `RouteInfo` validation already works.
//!
//! `library_*`, `config_*`, and `server_*` commands are intentionally
//! omitted in the first slice; they remain reachable as untyped passthrough
//! through `admin_dispatch::handle()` until they get typed in a follow-up.

/// authorization required to invoke an admin command.
///
/// today every admin command requires the admin role; this enum exists to
/// future-proof the registry for finer-grained gates (e.g. root-only).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdminAuth {
    /// caller must have at least the admin role
    Admin,
}

impl AdminAuth {
    pub fn as_str(&self) -> &'static str {
        match self {
            AdminAuth::Admin => "admin",
        }
    }
}

/// metadata describing a single admin command.
#[derive(Debug, Clone, Copy)]
pub struct AdminCommandInfo {
    /// command identifier matched in `admin_dispatch::handle()`
    pub name: &'static str,
    /// rust request type (or `"EmptyRequest"` / `"()"` if no payload)
    pub request_type: &'static str,
    /// rust response type (use `"EmptyResponse"` for no-data success,
    /// `"Vec<X>"` for arrays, `"serde_json::Value"` for untyped passthrough)
    pub response_type: &'static str,
    /// what role may invoke the command
    pub auth: AdminAuth,
}

/// every admin command currently typed for codegen.
pub const ADMIN_COMMANDS: &[AdminCommandInfo] = &[
    // -- knocks --
    AdminCommandInfo {
        name: "knocks_list",
        request_type: "EmptyRequest",
        response_type: "Vec<KnockRequest>",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "knocks_list_all",
        request_type: "EmptyRequest",
        response_type: "Vec<KnockRequest>",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "knocks_accept",
        request_type: "KnocksAcceptRequest",
        response_type: "KnockRequest",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "knocks_reject",
        request_type: "KnocksRejectRequest",
        response_type: "KnockRequest",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "knocks_delete",
        request_type: "KnocksDeleteRequest",
        response_type: "EmptyResponse",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "knocks_reject_all",
        request_type: "EmptyRequest",
        response_type: "KnocksRejectAllResponse",
        auth: AdminAuth::Admin,
    },
    // -- users --
    AdminCommandInfo {
        name: "users_list",
        request_type: "AdminUsersListRequest",
        response_type: "Vec<AdminUserSummary>",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "users_get",
        request_type: "AdminUsersGetRequest",
        response_type: "AdminUserSummary",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "users_update_role",
        request_type: "AdminUsersUpdateRoleRequest",
        response_type: "EmptyResponse",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "users_delete",
        request_type: "AdminUsersDeleteRequest",
        response_type: "EmptyResponse",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "users_generate_account_link",
        request_type: "AdminUsersGenerateAccountLinkRequest",
        response_type: "AdminAccountLinkResponse",
        auth: AdminAuth::Admin,
    },
    // -- invites --
    AdminCommandInfo {
        name: "invites_list",
        request_type: "AdminInvitesListRequest",
        response_type: "Vec<AdminInviteInfo>",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "invites_generate",
        request_type: "AdminInvitesGenerateRequest",
        response_type: "AdminInvitesGenerateResponse",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "invites_revoke",
        request_type: "AdminInvitesRevokeRequest",
        response_type: "EmptyResponse",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "invites_revoke_all",
        request_type: "EmptyRequest",
        response_type: "AdminInvitesRevokeAllResponse",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "invites_update_role",
        request_type: "AdminInvitesUpdateRoleRequest",
        response_type: "EmptyResponse",
        auth: AdminAuth::Admin,
    },
    // -- peers --
    AdminCommandInfo {
        name: "peers_list_all",
        request_type: "EmptyRequest",
        response_type: "Vec<AdminPeerSummary>",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "peers_list_for_user",
        request_type: "AdminPeersListForUserRequest",
        response_type: "Vec<AdminPeerNodeSummary>",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "peers_remove",
        request_type: "AdminPeersRemoveRequest",
        response_type: "EmptyResponse",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "peers_allow",
        request_type: "AdminPeersAllowRequest",
        response_type: "AdminPeersAllowResponse",
        auth: AdminAuth::Admin,
    },
    // -- radio --
    AdminCommandInfo {
        name: "radio_stations_list",
        request_type: "EmptyRequest",
        response_type: "Vec<RadioStation>",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "radio_stations_get",
        request_type: "RadioStationsByIdRequest",
        response_type: "RadioStation",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "radio_stations_create",
        request_type: "CreateStationRequest",
        response_type: "RadioStation",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "radio_stations_update",
        request_type: "UpdateStationRequest",
        response_type: "RadioStation",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "radio_stations_delete",
        request_type: "RadioStationsByIdRequest",
        response_type: "EmptyResponse",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "radio_filters_list",
        request_type: "RadioStationByStationIdRequest",
        response_type: "Vec<StationFilter>",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "radio_filters_add",
        request_type: "RadioFiltersAddRequest",
        response_type: "StationFilter",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "radio_filters_remove",
        request_type: "RadioFiltersRemoveRequest",
        response_type: "EmptyResponse",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "radio_songs_list",
        request_type: "RadioStationByStationIdRequest",
        response_type: "Vec<StationSong>",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "radio_songs_add",
        request_type: "RadioSongsAddRequest",
        response_type: "EmptyResponse",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "radio_songs_remove",
        request_type: "RadioSongsRemoveRequest",
        response_type: "EmptyResponse",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "radio_seed_suggest",
        request_type: "RadioSeedSuggestRequest",
        response_type: "Vec<RadioSeedSuggestion>",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "radio_config_get",
        request_type: "EmptyRequest",
        response_type: "RadioConfigPayload",
        auth: AdminAuth::Admin,
    },
    AdminCommandInfo {
        name: "radio_config_set",
        request_type: "RadioConfigPayload",
        response_type: "RadioConfigPayload",
        auth: AdminAuth::Admin,
    },
];

/// accessor mirroring `offal::all_routes()` for use by codegen.
pub fn all_commands() -> &'static [AdminCommandInfo] {
    ADMIN_COMMANDS
}
