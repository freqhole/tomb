//! no-arg fallback list. mirrors `grimoire::admin_dispatch::registry`
//! so both shells expose the same surface, plus a few public/untyped
//! commands that aren't in the registry (e.g. `server_info`).
//!
//! keep entries in sync with `grimoire/src/admin_dispatch/registry.rs`.
//! drift just means a command is missing from the palette — it'll
//! still dispatch fine if you type the name in.

pub(super) const NO_ARG_COMMANDS: &[(&str, &str, &str)] = &[
    // -- knocks --
    ("knocks_list", "EmptyRequest", "Vec<KnockRequest>"),
    ("knocks_list_all", "EmptyRequest", "Vec<KnockRequest>"),
    (
        "knocks_reject_all",
        "EmptyRequest",
        "KnocksRejectAllResponse",
    ),
    // -- users --
    (
        "users_list",
        "AdminUsersListRequest",
        "Vec<AdminUserSummary>",
    ),
    (
        "users_hard_delete",
        "AdminUsersHardDeleteRequest",
        "EmptyResponse",
    ),
    // -- invites --
    (
        "invites_list",
        "AdminInvitesListRequest",
        "Vec<AdminInviteInfo>",
    ),
    (
        "invites_generate",
        "AdminInvitesGenerateRequest",
        "AdminInvitesGenerateResponse",
    ),
    (
        "invites_revoke",
        "AdminInvitesRevokeRequest",
        "EmptyResponse",
    ),
    (
        "invites_revoke_all",
        "EmptyRequest",
        "AdminInvitesRevokeAllResponse",
    ),
    (
        "invites_update_role",
        "AdminInvitesUpdateRoleRequest",
        "EmptyResponse",
    ),
    // -- peers --
    (
        "peers_list_all",
        "AdminPeersListAllRequest",
        "Vec<AdminPeerSummary>",
    ),
    (
        "peers_list_for_user",
        "AdminPeersListForUserRequest",
        "Vec<AdminPeerNodeSummary>",
    ),
    ("peers_remove", "AdminPeersRemoveRequest", "EmptyResponse"),
    ("peers_restore", "AdminPeersRestoreRequest", "EmptyResponse"),
    (
        "peers_allow",
        "AdminPeersAllowRequest",
        "AdminPeersAllowResponse",
    ),
    // -- radio --
    ("radio_stations_list", "EmptyRequest", "Vec<RadioStation>"),
    (
        "radio_stations_get",
        "RadioStationsByIdRequest",
        "RadioStation",
    ),
    (
        "radio_stations_create",
        "CreateStationRequest",
        "RadioStation",
    ),
    (
        "radio_stations_update",
        "UpdateStationRequest",
        "RadioStation",
    ),
    (
        "radio_stations_delete",
        "RadioStationsByIdRequest",
        "EmptyResponse",
    ),
    (
        "radio_filters_list",
        "RadioStationByStationIdRequest",
        "Vec<StationFilter>",
    ),
    (
        "radio_filters_add",
        "RadioFiltersAddRequest",
        "StationFilter",
    ),
    (
        "radio_filters_remove",
        "RadioFiltersRemoveRequest",
        "EmptyResponse",
    ),
    (
        "radio_seed_suggest",
        "RadioSeedSuggestRequest",
        "Vec<RadioSeedSuggestion>",
    ),
    ("radio_config_get", "EmptyRequest", "RadioConfigPayload"),
    (
        "radio_config_set",
        "RadioConfigPayload",
        "RadioConfigPayload",
    ),
    (
        "radio_supervisor_status",
        "EmptyRequest",
        "RadioSupervisorStatusResponse",
    ),
    (
        "radio_supervisor_start",
        "RadioSupervisorStationRequest",
        "RadioSupervisorStatusResponse",
    ),
    (
        "radio_supervisor_stop",
        "RadioSupervisorStationRequest",
        "RadioSupervisorStatusResponse",
    ),
    (
        "radio_supervisor_restart",
        "RadioSupervisorStationRequest",
        "RadioSupervisorStatusResponse",
    ),
    (
        "radio_supervisor_skip_track",
        "RadioSupervisorStationRequest",
        "RadioSupervisorStatusResponse",
    ),
    ("radio_bumpers_list", "EmptyRequest", "Vec<RadioBumper>"),
    ("radio_bumpers_add", "RadioBumpersAddRequest", "RadioBumper"),
    (
        "radio_bumpers_remove",
        "RadioBumpersRemoveRequest",
        "EmptyResponse",
    ),
    (
        "radio_bumpers_set_frequency",
        "RadioBumpersSetFrequencyRequest",
        "RadioBumper",
    ),
    // -- meta / public --
    // server_info isn't in the typed registry but the dispatcher
    // routes it to `offal::public::health::server_info()` and
    // returns a small json blob. handy quick-test command.
    ("server_info", "EmptyRequest", "serde_json::Value"),
    // -- maintenance (no-arg) --
    (
        "maintenance_backfill_thumbnails_count",
        "EmptyRequest",
        "u32",
    ),
    (
        "maintenance_update_server_image",
        "EmptyRequest",
        "serde_json::Value",
    ),
    (
        "maintenance_update_spume",
        "EmptyRequest",
        "serde_json::Value",
    ),
    // -- dir_tags (no-arg) --
    (
        "dir_tags_list_rules",
        "EmptyRequest",
        "Vec<DirectoryTagRule>",
    ),
    // -- analytics reads (no-arg) --
    ("analytics_admin_overview", "EmptyRequest", "OverviewStats"),
    // -- database --
    ("database_test", "EmptyRequest", "DatabaseTestResponse"),
    ("database_info", "EmptyRequest", "DatabaseInfoResponse"),
    // -- jobs --
    ("jobs_stats", "EmptyRequest", "QueueStats"),
    // -- blobz --
    ("blobz_blake3_status", "EmptyRequest", "serde_json::Value"),
    // -- federation --
    ("federation_status", "EmptyRequest", "serde_json::Value"),
];
