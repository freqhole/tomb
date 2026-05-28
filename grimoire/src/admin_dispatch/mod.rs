//! admin command dispatch
//!
//! single source of truth for the wizard-admin command surface. used by:
//! - the local tauri `admin_dispatch` command (slice 4) — calls with
//!   `Caller::local_admin()`
//! - the remote `freqhole-admin/1` ALPN handler (slice 2) — calls with the
//!   resolved admin caller for the connecting peer
//!
//! every entry point enforces `caller.role.is_admin()` defense-in-depth,
//! independent of transport-level checks.
//!
//! see docs/wizard-remote-admin.md for the full plan and command list.
//!
//! # module layout
//!
//! - [`registry`]: serializable manifest of all commands (req/resp shapes,
//!   auth level) used by codegen and clients.
//! - [`types`]: per-domain wire-shape structs, also used by codegen.
//! - [`helpers`]: shared scaffolding (decode/forbidden/to_value/parse_role).
//! - [`handlers`]: one submodule per domain holding the actual command fns.
//!
//! the dispatcher below is intentionally thin — it just maps command
//! strings to handler fns. all logic lives in [`handlers`].

pub mod registry;
pub mod types;

mod handlers;
mod helpers;

use crate::admin_dispatch::helpers::{command_not_found, forbidden, to_value};
use crate::error::ErrorDetail;
use crate::federation::knock;
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

/// dispatch an admin command to its handler.
///
/// returns `GrimoireResponse<JsonValue>` for uniform serialization across
/// transports. unknown commands return a `command_not_found` error.
pub async fn handle(
    command: &str,
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    if !caller.role.is_admin() {
        return forbidden();
    }

    match command {
        // -- knocks --
        "knocks_list" => {
            let resp = knock::list_knocks(false).await;
            tracing::info!(
                "[admin-dispatch] knocks_list success={} count={}",
                resp.success,
                resp.data.as_ref().map(|v| v.len()).unwrap_or(0)
            );
            to_value(resp)
        }
        "knocks_list_all" => {
            let resp = knock::list_knocks(true).await;
            tracing::info!(
                "[admin-dispatch] knocks_list_all success={} count={}",
                resp.success,
                resp.data.as_ref().map(|v| v.len()).unwrap_or(0)
            );
            to_value(resp)
        }
        "knocks_accept" => handlers::knocks::accept(args, caller).await,
        "knocks_reject" => handlers::knocks::reject(args, caller).await,
        "knocks_delete" => handlers::knocks::delete(args).await,
        "knocks_reject_all" => handlers::knocks::reject_all(caller).await,

        // -- users --
        "users_list" => handlers::users::list(args, caller).await,
        "users_list_assignable" => handlers::users::list_assignable(args, caller).await,
        "users_get" => handlers::users::get(args).await,
        "users_create" => handlers::users::create(args).await,
        "users_update_role" => handlers::users::update_role(args, caller).await,
        "users_delete" => handlers::users::delete(args, caller).await,
        "users_hard_delete" => handlers::users::hard_delete(args, caller).await,
        "users_restore" => handlers::users::restore(args, caller).await,
        "users_generate_account_link" => handlers::users::generate_account_link(args, caller).await,
        "users_generate_api_key" => handlers::users::generate_api_key(args).await,
        "users_revoke_api_key" => handlers::users::revoke_api_key(args).await,
        "users_hard_delete_peer_node" => handlers::users::hard_delete_peer_node(args).await,
        "users_add_peer_node" => handlers::users::add_peer_node(args).await,
        "users_remove_peer_node" => handlers::users::remove_peer_node(args).await,

        // -- invites --
        "invites_list" => handlers::invites::list(args, caller).await,
        "invites_generate" => handlers::invites::generate(args, caller).await,
        "invites_revoke" => handlers::invites::revoke(args, caller).await,
        "invites_revoke_all" => handlers::invites::revoke_all(caller).await,
        "invites_update_role" => handlers::invites::update_role(args, caller).await,

        // -- peers --
        "peers_list_all" => handlers::peers::list_all(args).await,
        "peers_list_for_user" => handlers::peers::list_for_user(args).await,
        "peers_remove" => handlers::peers::remove(args).await,
        "peers_restore" => handlers::peers::restore(args).await,
        "peers_hard_delete" => handlers::peers::hard_delete(args).await,
        "peers_reassign_user" => handlers::peers::reassign_user(args).await,
        "peers_allow" => handlers::peers::allow(args).await,

        // -- library --
        "library_validate_path" => handlers::library::validate_path(args).await,
        "library_scan" => handlers::library::scan(args).await,
        "library_scan_status" => handlers::library::scan_status(args).await,
        "library_image_upload" => handlers::library::image_upload(args, caller).await,
        "library_list_directories" => handlers::library::list_directories().await,
        "library_remove_directory" => handlers::library::remove_directory(args).await,
        "library_move_directory" => handlers::library::move_directory(args, caller).await,
        "library_rescan_all" => handlers::library::rescan_all(caller).await,
        "library_repair_orphans" => handlers::library::repair_orphans().await,
        "library_fetch" => handlers::library::fetch(args, caller).await,

        // -- config / server --
        "config_get" => handlers::server_config::config_get().await,
        "config_set" => handlers::server_config::config_set(args).await,
        "server_restart" => handlers::server_config::server_restart(args).await,
        "server_info" => crate::offal::public::health::server_info().await,
        "server_get_config" => handlers::server_config::server_get_config().await,
        "server_get_image_thumbnail" => {
            handlers::server_config::server_get_image_thumbnail(args).await
        }
        "server_update_info" => handlers::server_config::server_update_info(args).await,
        "server_update_image" => handlers::server_config::server_update_image(args).await,

        // -- radio --
        "radio_stations_list" => handlers::radio::stations_list().await,
        "radio_stations_get" => handlers::radio::stations_get(args).await,
        "radio_stations_create" => handlers::radio::stations_create(args).await,
        "radio_stations_update" => handlers::radio::stations_update(args).await,
        "radio_stations_delete" => handlers::radio::stations_delete(args).await,
        "radio_filters_list" => handlers::radio::filters_list(args).await,
        "radio_filters_add" => handlers::radio::filters_add(args).await,
        "radio_filters_remove" => handlers::radio::filters_remove(args).await,
        "radio_songs_list" | "radio_songs_add" | "radio_songs_remove" => {
            // explicit per-track inclusion is now expressed as a
            // `track`-typed filter row — use radio_filters_* instead.
            GrimoireResponse::failure(
                "radio_songs_* commands were removed; use radio_filters_* with filter_type='track'",
                vec![ErrorDetail::new(
                    "unsupported_command",
                    "command removed",
                    "explicit station songs are now filter rows (filter_type='track')",
                )],
            )
        }
        "radio_seed_suggest" => handlers::radio::seed_suggest(args).await,
        "radio_config_get" => handlers::radio::config_get().await,
        "radio_config_set" => handlers::radio::config_set(args).await,
        "radio_supervisor_status" => handlers::radio::supervisor_status().await,
        "radio_supervisor_start" => handlers::radio::supervisor_start(args).await,
        "radio_supervisor_stop" => handlers::radio::supervisor_stop(args).await,
        "radio_supervisor_restart" => handlers::radio::supervisor_restart(args).await,
        "radio_supervisor_skip_track" => handlers::radio::supervisor_skip_track(args).await,
        "radio_bumpers_list" => handlers::radio::bumpers_list(args).await,
        "radio_bumpers_add" => handlers::radio::bumpers_add(args).await,
        "radio_bumpers_remove" => handlers::radio::bumpers_remove(args).await,
        "radio_bumpers_set_frequency" => handlers::radio::bumpers_set_frequency(args).await,

        // -- maintenance --
        "maintenance_cleanup_orphaned_tags" => {
            handlers::maintenance::cleanup_orphaned_tags(args).await
        }
        "maintenance_cleanup_orphaned_genres" => {
            handlers::maintenance::cleanup_orphaned_genres(args).await
        }
        "maintenance_cleanup_all" => handlers::maintenance::cleanup_all(args).await,
        "maintenance_backfill_blake3" => handlers::maintenance::backfill_blake3(args).await,
        "maintenance_backfill_thumbnails_count" => {
            handlers::maintenance::backfill_thumbnails_count().await
        }
        "maintenance_backfill_thumbnails" => {
            handlers::maintenance::backfill_thumbnails(args, caller).await
        }
        "maintenance_update_server_image" => handlers::maintenance::update_server_image().await,
        "maintenance_update_spume" => handlers::maintenance::update_spume().await,
        "maintenance_cleanup_orphaned_blobs" => {
            handlers::maintenance::cleanup_orphaned_blobs(args).await
        }
        "maintenance_hard_delete_old_records" => {
            handlers::maintenance::hard_delete_old_records(args).await
        }
        "maintenance_run_full" => handlers::maintenance::run_full(args).await,

        // -- dir_tags --
        "dir_tags_list_rules" => handlers::dir_tags::list_rules().await,
        "dir_tags_list" => handlers::dir_tags::list(args).await,
        "dir_tags_add" => handlers::dir_tags::add(args, caller).await,
        "dir_tags_remove" => handlers::dir_tags::remove(args).await,
        "dir_tags_clear" => handlers::dir_tags::clear(args).await,
        "dir_tags_strip" => handlers::dir_tags::strip(args).await,
        "dir_tags_clear_directory" => handlers::dir_tags::clear_directory(args).await,

        // -- analytics (read-only) --
        "analytics_admin_overview" => handlers::analytics::admin_overview().await,
        "analytics_top_songs" => handlers::analytics::top_songs(args).await,
        "analytics_top_albums" => handlers::analytics::top_albums(args).await,
        "analytics_top_artists" => handlers::analytics::top_artists(args).await,
        "analytics_user_stats" => handlers::analytics::user_stats(args).await,
        "analytics_all_user_stats" => handlers::analytics::all_user_stats(args).await,
        "analytics_song_stats" => handlers::analytics::song_stats(args).await,
        "analytics_user_history" => handlers::analytics::user_history(args).await,
        "analytics_session" => handlers::analytics::session(args).await,
        "analytics_recent_listens" => handlers::analytics::recent_listens(args).await,
        "analytics_recent_favorites" => handlers::analytics::recent_favorites(args).await,
        "analytics_recent_albums" => handlers::analytics::recent_albums(args).await,
        "analytics_feed" => handlers::analytics::feed(args).await,
        "analytics_counts" => handlers::analytics::counts(args).await,

        // -- database --
        "database_test" => handlers::database::test().await,
        "database_info" => handlers::database::info().await,

        // -- jobs --
        "jobs_list" => handlers::jobs::list(args).await,
        "jobs_stats" => handlers::jobs::stats().await,
        "jobs_cancel_session" => handlers::jobs::cancel_session(args).await,

        // -- music enrichment --
        "music_enrichment_tags" => handlers::enrichment::tags().await,
        "music_enrichment_resolve" => handlers::enrichment::resolve(args).await,
        "music_enrichment_bulk_start" => handlers::enrichment::bulk_start(args, caller).await,
        "music_enrichment_bulk_auto_confirm" => {
            handlers::enrichment::bulk_auto_confirm(args, caller).await
        }
        "music_enrichment_bulk_auto" => handlers::enrichment::bulk_auto(args, caller).await,

        // -- genres --
        "genres_list" => handlers::genres::list().await,
        "genres_list_with_stats" => handlers::genres::list_with_stats().await,
        "genres_stats" => handlers::genres::stats().await,
        "genres_get" => handlers::genres::get(args).await,
        "genres_create" => handlers::genres::create(args).await,
        "genres_delete" => handlers::genres::delete(args, caller).await,
        "genres_add_to_album" => handlers::genres::add_to_album(args).await,
        "genres_remove_from_album" => handlers::genres::remove_from_album(args).await,
        "genres_album_genres" => handlers::genres::album_genres(args).await,
        "genres_songs" => handlers::genres::songs(args).await,

        // -- tags (album tags) --
        "tags_list" => handlers::tags::list().await,
        "tags_query" => handlers::tags::query(args).await,
        "tags_get" => handlers::tags::get(args).await,
        "tags_create" => handlers::tags::create(args).await,
        "tags_delete" => handlers::tags::delete(args, caller).await,
        "tags_album_tags" => handlers::tags::album_tags(args).await,
        "tags_add_to_album" => handlers::tags::add_to_album(args).await,
        "tags_remove_from_album" => handlers::tags::remove_from_album(args).await,

        // -- blobz --
        "blobz_blake3_status" => handlers::blobz::blake3_status().await,
        "blobz_backfill_blake3" => handlers::blobz::backfill_blake3(args).await,
        "blobz_check_references" => handlers::blobz::check_references(args).await,

        // -- federation --
        "federation_status" => handlers::federation::status().await,

        _ => command_not_found(command),
    }
}
