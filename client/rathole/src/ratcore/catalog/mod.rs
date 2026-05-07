//! shared seed list of admin commands surfaced by both shells.
//!
//! historically each shell hand-rolled its own list:
//! - the wasm shell had `sample_commands()` (knocks_list,
//!   users_list, server_info, knock).
//! - the tty shell pulled `grimoire::admin_dispatch::registry`
//!   directly (a much longer list, but with no rich arg specs).
//!
//! that meant the two shells exposed different commands for no
//! good reason, and rich `ArgKind`s (SelectFrom, OneOf, Text)
//! had to be duplicated. this module is the single source of
//! truth; both shells should call [`commands()`] at boot.
//!
//! when adding a new command:
//! - if it's a no-arg dispatch, just append to the
//!   [`no_arg_commands::NO_ARG_COMMANDS`] list.
//! - if it needs a form, add a builder in the appropriate
//!   `builders/<domain>.rs` file (or pull in a domain that doesn't
//!   exist yet) and reference it from [`rich_commands()`].
//!
//! # module layout
//!
//! - [`widgets`]: shared `ArgSpec` factories (`pick_user`, `dry_run_arg`,
//!   etc.) used across multiple builders.
//! - [`builders`]: one submodule per domain holding the rich-form
//!   command builders.
//! - [`no_arg_commands`]: the `NO_ARG_COMMANDS` const, mirroring the
//!   server-side registry.

mod builders;
mod no_arg_commands;
mod widgets;

use crate::ratcore::app::{ActionMenuOption, AdminCommand};
use no_arg_commands::NO_ARG_COMMANDS;

/// build the full seed command list.
///
/// rich-form commands are returned first (so they cluster at the
/// top of the palette), followed by every other registry entry
/// rendered as a no-arg admin dispatch. plus a few public
/// commands (e.g. `knock`) the wasm shell needs.
pub fn commands() -> Vec<AdminCommand> {
    let mut out: Vec<AdminCommand> = rich_commands();

    // append no-arg admin commands that don't have a rich form
    // yet. anything in `rich_commands()` above wins.
    for &(name, req, resp) in NO_ARG_COMMANDS {
        if out.iter().any(|c| c.name == name) {
            continue;
        }
        out.push(AdminCommand::admin_noargs(name, req, resp));
    }

    // sort by group prefix, then by name. keeps maintenance_*,
    // dir_tags_*, analytics_*, etc. clustered in the palette so
    // they're easier to discover and scroll through.
    out.sort_by(|a, b| {
        let ga = a.group();
        let gb = b.group();
        ga.cmp(gb).then_with(|| a.name.cmp(&b.name))
    });
    out
}

/// hand-written commands with full arg specs so the form picker
/// (and SelectFrom dropdowns) work. anything listed here
/// shadows the no-arg fallback below.
fn rich_commands() -> Vec<AdminCommand> {
    vec![
        // -- knocks --
        builders::knocks::accept(),
        builders::knocks::reject(),
        builders::knocks::delete(),
        // -- users --
        builders::users::list(),
        builders::users::get(),
        builders::users::update_role(),
        builders::users::delete(),
        builders::users::hard_delete(),
        builders::users::restore(),
        builders::users::generate_account_link(),
        builders::users::generate_api_key(),
        builders::users::revoke_api_key(),
        builders::users::hard_delete_peer_node(),
        // -- invites --
        builders::invites::list(),
        builders::invites::generate(),
        builders::invites::revoke(),
        builders::invites::update_role(),
        // -- peers --
        builders::peers::list_all(),
        builders::peers::list_for_user(),
        builders::peers::remove(),
        builders::peers::restore(),
        builders::peers::allow(),
        // -- radio --
        builders::radio::stations_get(),
        builders::radio::stations_create(),
        builders::radio::stations_update(),
        builders::radio::stations_delete(),
        builders::radio::supervisor_start(),
        builders::radio::supervisor_stop(),
        builders::radio::supervisor_restart(),
        builders::radio::supervisor_skip_track(),
        builders::radio::filters_list(),
        builders::radio::filters_add(),
        builders::radio::filters_remove(),
        builders::radio::bumpers_add(),
        builders::radio::bumpers_remove(),
        builders::radio::bumpers_set_frequency(),
        builders::radio::seed_suggest(),
        builders::radio::config_set(),
        // -- public --
        builders::public::knock(),
        // -- maintenance (rich) --
        builders::maintenance::cleanup_orphaned_tags(),
        builders::maintenance::cleanup_orphaned_genres(),
        builders::maintenance::cleanup_all(),
        builders::maintenance::backfill_thumbnails(),
        builders::maintenance::cleanup_orphaned_blobs(),
        builders::maintenance::hard_delete_old_records(),
        builders::maintenance::run_full(),
        // -- dir_tags (rich) --
        builders::dir_tags::list(),
        builders::dir_tags::add(),
        builders::dir_tags::remove(),
        builders::dir_tags::clear(),
        builders::dir_tags::strip(),
        builders::dir_tags::clear_directory(),
        // -- analytics reads (rich) --
        builders::analytics::top_songs(),
        builders::analytics::top_albums(),
        builders::analytics::top_artists(),
        builders::analytics::user_stats(),
        builders::analytics::all_user_stats(),
        builders::analytics::song_stats(),
        builders::analytics::user_history(),
        builders::analytics::session(),
        builders::analytics::recent_listens(),
        builders::analytics::recent_favorites(),
        builders::analytics::recent_albums(),
        builders::analytics::feed(),
        builders::analytics::counts(),
        // -- jobs (rich) --
        builders::jobs::list(),
        // -- blobz (rich) --
        builders::blobz::backfill_blake3(),
        builders::blobz::check_references(),
    ]
}

/// per-list-command actions surfaced by the result-pane action menu.
/// every list-style command should have at least a `get` / `delete`
/// pair where it makes sense; commands with no entry here fall back
/// to the generic actions appended at the end of every list.
pub fn result_actions(command_name: &str) -> Vec<ActionMenuOption> {
    result_actions_for_row(command_name, None)
}

/// like [`result_actions`] but inspects the row to add row-specific
/// actions. for unified-search rows tagged with `"type"`, this picks
/// up `play`/`favorite`/`add to playlist` per type. for music list
/// commands (`library_song`, `library_album`, `library_playlist`,
/// `library_artist`, `library_favorites`) the same logic applies.
pub fn result_actions_for_row(
    command_name: &str,
    row: Option<&serde_json::Value>,
) -> Vec<ActionMenuOption> {
    // if the row carries a `type` tag (unified search), use that to
    // select music actions regardless of the source command.
    let row_type = row.and_then(|v| v.get("type")).and_then(|v| v.as_str());

    let mut out = Vec::new();
    let push = |out: &mut Vec<ActionMenuOption>, label: &str, target: &str| {
        out.push(ActionMenuOption {
            label: label.to_string(),
            target_command: target.to_string(),
        });
    };

    // music-row actions: by row.type (preferred) or by command name.
    let music_kind = row_type.or_else(|| match command_name {
        "library_song" => Some("song"),
        "library_album" => Some("album"),
        "library_playlist" => Some("playlist"),
        "library_artist" => Some("artist"),
        _ => None,
    });
    // queue-context rows (synthesized by the /queue slash handler)
    // get queue-management actions instead of normal music actions.
    // detected via command_name=="queue" so we don't accidentally
    // surface them on every song row in the library.
    if command_name == "queue" {
        push(&mut out, "jump to track", "__queue_jump__");
        push(&mut out, "remove from queue", "__queue_remove__");
        push(&mut out, "move up", "__queue_move_up__");
        push(&mut out, "move down", "__queue_move_down__");
        push(&mut out, "clear queue", "__queue_clear__");
        push(&mut out, "go to album", "__goto_album__");
        push(&mut out, "go to artist", "__goto_artist__");
        out.push(ActionMenuOption {
            label: "view full row".to_string(),
            target_command: "__view_row__".to_string(),
        });
        return out;
    }

    match music_kind {
        Some("song") => {
            push(&mut out, "play", "__play_song__");
            push(&mut out, "add to queue", "__enqueue_song__");
            push(&mut out, "go to album", "__goto_album__");
            push(&mut out, "go to artist", "__goto_artist__");
            push(&mut out, "toggle favorite", "__toggle_favorite_song__");
            push(&mut out, "add to playlist", "__add_to_playlist__");
        }
        Some("album") => {
            push(&mut out, "play", "__play_album__");
            push(&mut out, "add to queue", "__enqueue_album__");
            push(&mut out, "go to artist", "__goto_artist__");
            push(&mut out, "toggle favorite", "__toggle_favorite_album__");
            push(&mut out, "add to playlist", "__add_album_to_playlist__");
        }
        Some("playlist") => {
            push(&mut out, "play", "__play_playlist__");
            push(&mut out, "add to queue", "__enqueue_playlist__");
            push(&mut out, "toggle favorite", "__toggle_favorite_playlist__");
        }
        Some("artist") => {
            push(&mut out, "toggle favorite", "__toggle_favorite_artist__");
        }
        _ => {}
    }

    let admin_opts: &[(&str, &str)] = match command_name {
        "users_list" => &[
            ("get", "users_get"),
            ("update role", "users_update_role"),
            ("delete (soft)", "users_delete"),
            ("delete (hard)", "users_hard_delete"),
            ("restore", "users_restore"),
            ("generate account link", "users_generate_account_link"),
        ],
        "knocks_list" | "knocks_list_all" => &[
            ("accept", "knocks_accept"),
            ("reject", "knocks_reject"),
            ("delete", "knocks_delete"),
        ],
        "invites_list" => &[
            ("revoke", "invites_revoke"),
            ("update role", "invites_update_role"),
        ],
        "peers_list_all" | "peers_list_for_user" => {
            &[("remove", "peers_remove"), ("restore", "peers_restore")]
        }
        "radio_stations_list" => &[
            ("get", "radio_stations_get"),
            ("update", "radio_stations_update"),
            ("delete", "radio_stations_delete"),
            ("start", "radio_supervisor_start"),
            ("stop", "radio_supervisor_stop"),
            ("restart", "radio_supervisor_restart"),
            ("skip track", "radio_supervisor_skip_track"),
            ("list filters", "radio_filters_list"),
        ],
        "radio_filters_list" => &[("remove", "radio_filters_remove")],
        "radio_bumpers_list" => &[
            ("remove", "radio_bumpers_remove"),
            ("set frequency", "radio_bumpers_set_frequency"),
        ],
        "library_favorites" => &[("toggle favorite", "__toggle_favorite_favorite__")],
        _ => &[],
    };
    for (label, target) in admin_opts {
        push(&mut out, label, target);
    }

    // generic fallback: every row, regardless of list, can at least
    // be inspected. the special target name is recognised by the
    // shells' action-menu key handler and rendered as a json popup
    // instead of opening a form.
    out.push(ActionMenuOption {
        label: "view full row".to_string(),
        target_command: "__view_row__".to_string(),
    });
    out
}

/// extract a stable id + display title from a result-panel row,
/// looking through wrapper objects when present (e.g.
/// `PlaylistQueryResult { playlist: { id, title } }`,
/// `AlbumQueryResult { album: { id, title } }`,
/// `PlaylistSongResult { details: { song: { id, title } } }`,
/// or unified-search rows with `{ id, title, type }` at top level).
/// returns `(id, title, kind)` where `kind` is the wrapper key
/// when applicable (`"playlist"`, `"album"`, `"artist"`, `"song"`).
pub fn row_id_and_title(
    row: &serde_json::Value,
) -> (Option<String>, Option<String>, Option<String>) {
    let s = |v: Option<&serde_json::Value>| v.and_then(|x| x.as_str()).map(|s| s.to_string());
    // unified-search row: `{ id, title, type }`.
    let top_id = s(row.get("id"));
    let top_title = s(row.get("title")).or_else(|| s(row.get("name")));
    let top_type = s(row.get("type"));
    if top_type.is_some() && top_id.is_some() {
        return (top_id, top_title, top_type);
    }
    for kind in ["playlist", "album", "artist", "song", "genre"] {
        if let Some(inner) = row.get(kind) {
            let id = s(inner.get("id"));
            let title = s(inner.get("title")).or_else(|| s(inner.get("name")));
            if id.is_some() {
                return (id, title, Some(kind.to_string()));
            }
        }
    }
    if let Some(details) = row.get("details") {
        if let Some(song) = details.get("song") {
            let id = s(song.get("id"));
            let title = s(song.get("title"));
            if id.is_some() {
                return (id, title, Some("song".to_string()));
            }
        }
    }
    (top_id, top_title, None)
}

/// extract album_id + artist_id hints from a result-panel row,
/// looking through wrapper objects + common synonyms. used by the
/// "go to album" / "go to artist" actions to pivot the result panel
/// to the matching library_by_id query. returns `(album_id, artist_id)`.
///
/// for a row tagged `type: "album"` the row's own `id` field is the
/// album id; same for `type: "artist"`. for song rows we look for
/// nested `album.id` / `artist.id` (SongQueryResult shape) plus
/// top-level `album_id` / `artist_id` (queue rows + flat shapes).
pub fn row_album_and_artist(row: &serde_json::Value) -> (Option<String>, Option<String>) {
    let s = |v: Option<&serde_json::Value>| {
        v.and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty())
    };

    // start with explicit fk fields if present.
    let mut album_id = s(row.get("album_id"));
    let mut artist_id = s(row.get("artist_id"));

    // if this row IS the album / artist itself, the row's `id` is
    // the relevant id.
    let row_type = row.get("type").and_then(|v| v.as_str());
    match row_type {
        Some("album") => {
            album_id = album_id.or_else(|| s(row.get("id")));
        }
        Some("artist") => {
            artist_id = artist_id.or_else(|| s(row.get("id")));
        }
        _ => {}
    }

    // SongQueryResult / AlbumQueryResult wrappers expose `album.id`
    // and `artist.id` directly.
    for kind in ["song", "album", "artist", "playlist"] {
        if album_id.is_some() && artist_id.is_some() {
            break;
        }
        if let Some(inner) = row.get(kind) {
            // explicit fk inside the wrapper
            album_id = album_id.or_else(|| s(inner.get("album_id")));
            artist_id = artist_id.or_else(|| s(inner.get("artist_id")));
        }
    }
    if let Some(album_obj) = row.get("album") {
        album_id = album_id.or_else(|| s(album_obj.get("id")));
    }
    if let Some(artist_obj) = row.get("artist") {
        artist_id = artist_id.or_else(|| s(artist_obj.get("id")));
    }
    if let Some(details) = row.get("details") {
        if album_id.is_none() {
            album_id = s(details.get("album_id"));
            if album_id.is_none() {
                if let Some(album_obj) = details.get("album") {
                    album_id = s(album_obj.get("id"));
                }
            }
        }
        if artist_id.is_none() {
            artist_id = s(details.get("artist_id"));
            if artist_id.is_none() {
                if let Some(artist_obj) = details.get("artist") {
                    artist_id = s(artist_obj.get("id"));
                }
            }
        }
    }
    (album_id, artist_id)
}
