//! unified play-queue manager — rathole owns the queue (see
//! `ratcore::app::queue::QueueEntry`); rodio and mpv are each treated
//! as single-track players, so every entry switch is a fresh
//! `PlayerCmd::Load`/`VideoCommand::Load` against `m.queue[m.current]`.
//! see docs/architecture-decisions for the rodio rationale (remove/
//! reorder/skip-forward would need multi-thread coordination against
//! rodio's own internal queue, and preloading N tracks is N chances to
//! hit rodio 0.20's m4a init-seek panic).
//!
//! the queue can mix audio and video entries (a controller's
//! `replace_queue`/`append_queue` push isn't required to be one kind)
//! - exactly one entry is ever the active, loaded-into-a-backend thing
//! (mirrors cenotaph's single-active-item queue model: one `<video>`
//! element, only `queue[0]` ever loaded). switching from one kind to
//! the other stops/closes whichever backend was driving the previous
//! entry first, so audio and video are never both active at once —
//! see docs/rathole-headless-player-plan.md's "fullscreen video ux".

use tokio::sync::mpsc;

use crate::ratcore::app::{
    App, AppAction, MusicEvent, PlayerState, QueueEntry, QueuedVideoRow, SongRow, VideoCommand,
    VideoEvent, VideoPlaybackState,
};
use crate::ratcore::transport::PlayerCmd;

/// max `MusicState::history` length - old entries are dropped once
/// exceeded so a long-running session doesn't grow this unbounded.
const HISTORY_CAP: usize = 50;

/// load and play the entry at `m.queue[idx]`, first dropping any
/// entries before `idx` into `MusicState::history` (most-recently-
/// finished first) - matches cenotaph/web's queue model, where the
/// queue only ever holds "currently playing + upcoming", not every
/// past track. clears any prior position state; audio entries resolve
/// + `PlayerCmd::Load` (rodio), video entries resolve + `VideoCommand::
/// Load` (mpv). on resolve failure the task emits an error event
/// followed by `MusicEvent::Ended` so the auto-advance handler skips
/// past the broken entry, same for both kinds.
pub fn play_index(app: &mut App, idx: usize, tx: &mpsc::UnboundedSender<AppAction>) {
    // mutually exclusive with radio - see `stop_for_radio`'s doc comment.
    if app.state.ephemeral.radio.active {
        super::radio::stop(app);
    }
    let was_video_active = app.state.ephemeral.music.queue_video_active;
    let was_audio_fallback_active = app.state.ephemeral.music.audio_fallback_active;
    if idx >= app.state.ephemeral.music.queue.len() {
        // ran off the end of the queue - everything left gets folded
        // into history (it was played/skipped through in full).
        let m = &mut app.state.ephemeral.music;
        let played: Vec<QueueEntry> = m.queue.drain(..).collect();
        push_history(m, played);
        m.current = None;
        m.position_ms = 0;
        m.duration_ms = 0;
        m.player_state = PlayerState::Stopped;
        m.queue_video_active = false;
        m.audio_fallback_active = false;
        m.pending_rodio_song_id = None;
        app.state.ephemeral.player_pairing.art_paths.clear();
        if was_video_active || was_audio_fallback_active {
            close_video(app);
        }
        return;
    }
    if idx > 0 {
        let m = &mut app.state.ephemeral.music;
        let played: Vec<QueueEntry> = m.queue.drain(0..idx).collect();
        push_history(m, played);
    }
    app.state.ephemeral.music.current = Some(0);
    app.state.ephemeral.music.position_ms = 0;
    app.state.ephemeral.music.duration_ms = 0;
    let entry = app.state.ephemeral.music.queue[0].clone();

    match entry {
        QueueEntry::Song(row) => {
            app.state.ephemeral.music.player_state = PlayerState::Loading;
            app.state.ephemeral.music.queue_video_active = false;
            app.state.ephemeral.music.audio_fallback_active = false;
            app.state.ephemeral.music.pending_rodio_song_id = Some(row.id.clone());
            // clear immediately (optimistic) so the previous song's art
            // doesn't linger until this one's resolves.
            app.state.ephemeral.player_pairing.art_paths.clear();
            // close the previous video backend (if one was active) and
            // load the new song as ONE ordered task - previously these
            // were two independent fire-and-forget spawns with no
            // ordering guarantee between them, so under adverse
            // scheduling the old video/mpv backend could still be
            // playing when rodio started ("multiple things playing").
            let close_first = if was_video_active || was_audio_fallback_active {
                app.state
                    .ephemeral
                    .video_player
                    .apply_command(&VideoCommand::Close);
                app.video_player.clone()
            } else {
                None
            };
            resolve_song_art(app, &row, tx);
            play_song_entry(app, row, close_first, tx);
        }
        QueueEntry::Video(video) => {
            app.state.ephemeral.music.player_state = PlayerState::Stopped;
            app.state.ephemeral.music.queue_video_active = true;
            app.state.ephemeral.music.audio_fallback_active = false;
            app.state.ephemeral.music.pending_rodio_song_id = None;
            app.state.ephemeral.player_pairing.art_paths.clear();
            // stop rodio (if it was the active backend) and load the
            // video as ONE ordered task - see the song-entry branch
            // above for why this must be sequenced rather than two
            // independent fire-and-forget spawns.
            let stop_first = app.player.clone();
            play_video_entry(app, video, stop_first, tx);
        }
    }
}

/// prepends `played` (in play order) to `history` most-recently-
/// finished first, then truncates to `HISTORY_CAP`.
fn push_history(m: &mut crate::ratcore::app::MusicState, mut played: Vec<QueueEntry>) {
    if played.is_empty() {
        return;
    }
    played.reverse();
    m.history.splice(0..0, played);
    m.history.truncate(HISTORY_CAP);
}

/// rodio couldn't decode the current queue entry's song (e.g. opus-in-
/// webm, or `.m4a` - blocked outright for rodio, see
/// `is_known_unplayable` - unsupported by rodio's symphonia backend)
/// - try it through mpv instead (audio-only: mpv was spawned with
/// `--force-window=no` and this file has no video track, so no window
/// opens). advances to the next queue entry instead if there's no mpv
/// backend, no current song, or resolving the path fails again.
pub fn try_mpv_audio_fallback(app: &mut App, tx: &mpsc::UnboundedSender<AppAction>) {
    app.state.ephemeral.music.pending_rodio_song_id = None;
    let Some(row) = app
        .state
        .ephemeral
        .music
        .currently_playing()
        .and_then(|e| e.as_song())
        .cloned()
    else {
        play_next(app, tx);
        return;
    };
    let Some(video_player) = app.video_player.clone() else {
        tracing::warn!(
            target: "rathole::tty::player",
            song = %row.title,
            "rodio couldn't decode this track and no mpv backend is available; skipping"
        );
        play_next(app, tx);
        return;
    };
    app.state.ephemeral.music.audio_fallback_active = true;
    let vp = &mut app.state.ephemeral.video_player;
    vp.state = VideoPlaybackState::Loading;
    vp.title = Some(row.title.clone());
    vp.last_error = None;
    let title = row.title.clone();
    let tx = tx.clone();
    tokio::task::spawn_local(async move {
        let Some(path) = resolve_song_path(&row).await else {
            let _ = tx.send(AppAction::VideoPlayerEvent(VideoEvent::Error {
                message: format!("mpv fallback: no playable file for {title} (skipping)"),
            }));
            return;
        };
        if let Err(e) = video_player
            .send(VideoCommand::Load {
                path,
                title: Some(title),
                start_seconds: None,
            })
            .await
        {
            let _ = tx.send(AppAction::VideoPlayerEvent(VideoEvent::Error { message: e }));
        }
    });
}

/// resolve `row.art_blob_ids` to local file paths (see
/// `player::resolve_paths`) in the background and report back via
/// `AppAction::SongArtResolved` - doesn't gate/slow down playback,
/// which resolves its own (possibly different) path independently.
/// logs at each step (target `rathole::tty::art`) so "no art showing"
/// can be diagnosed from the logs alone: zero blob ids means the song/
/// album/artist genuinely has no non-waveform image in the library;
/// zero resolved paths despite nonzero ids means the blob lookup
/// itself failed (see `player::resolve_paths`'s own per-id warning).
fn resolve_song_art(_app: &App, row: &SongRow, tx: &mpsc::UnboundedSender<AppAction>) {
    let song_id = row.id.clone();
    if !row.art_blob_ids.is_empty() {
        let art_blob_ids = row.art_blob_ids.clone();
        let n = art_blob_ids.len();
        let title = row.title.clone();
        let tx = tx.clone();
        tokio::task::spawn_local(async move {
            let paths = super::player::resolve_paths(&art_blob_ids).await;
            tracing::info!(
                target: "rathole::tty::art",
                song = %title,
                blob_ids = n,
                resolved = paths.len(),
                "resolved song art blob ids to local paths"
            );
            let _ = tx.send(AppAction::SongArtResolved { song_id, paths });
        });
        return;
    }
    if let Some(url) = row.art_url.clone() {
        let title = row.title.clone();
        let tx = tx.clone();
        tokio::task::spawn_local(async move {
            let paths = match super::art_fetch::resolve_art_url(&url).await {
                Ok(path) => vec![path],
                Err(e) => {
                    tracing::warn!(
                        target: "rathole::tty::art",
                        song = %title,
                        error = %e,
                        "failed to resolve remote-pushed song's art_url"
                    );
                    Vec::new()
                }
            };
            tracing::info!(
                target: "rathole::tty::art",
                song = %title,
                resolved = paths.len(),
                "resolved remote-pushed song art_url"
            );
            let _ = tx.send(AppAction::SongArtResolved { song_id, paths });
        });
        return;
    }
    tracing::info!(
        target: "rathole::tty::art",
        song = %row.title,
        "no art_blob_ids/art_url for this song (no song/album/artist image in the library, or a remote push with no art)"
    );
    let _ = tx.send(AppAction::SongArtResolved {
        song_id,
        paths: Vec::new(),
    });
}

fn play_song_entry(
    app: &mut App,
    row: SongRow,
    close_first: Option<std::rc::Rc<dyn crate::ratcore::transport::VideoPlayer>>,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    let Some(player) = app.player.clone() else {
        app.state.ephemeral.music.last_event_error =
            Some("no audio backend in this shell".to_string());
        return;
    };
    let title = row.title.clone();
    let tx = tx.clone();
    tokio::task::spawn_local(async move {
        // await the old video/mpv backend's close BEFORE loading the
        // new song into rodio, so the two are never both active.
        if let Some(video_player) = close_first {
            let _ = video_player.send(VideoCommand::Close).await;
        }
        let Some(path) = resolve_playable_path(&row).await else {
            let _ = tx.send(AppAction::MusicEvent(MusicEvent::Error(format!(
                "no playable file for {title} (skipping)"
            ))));
            let _ = tx.send(AppAction::MusicEvent(MusicEvent::Ended));
            return;
        };
        if let Err(e) = player.send(PlayerCmd::Load(vec![path])).await {
            let _ = tx.send(AppAction::MusicEvent(MusicEvent::Error(e)));
        }
    });
}

fn play_video_entry(
    app: &mut App,
    video: QueuedVideoRow,
    stop_first: Option<std::rc::Rc<dyn crate::ratcore::transport::MusicPlayer>>,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    let Some(video_player) = app.video_player.clone() else {
        app.state.ephemeral.music.last_event_error =
            Some("no video backend in this shell".to_string());
        return;
    };
    let vp = &mut app.state.ephemeral.video_player;
    vp.state = VideoPlaybackState::Loading;
    vp.title = Some(video.title.clone());
    vp.last_error = None;
    let title = video.title.clone();
    let tx = tx.clone();
    tokio::task::spawn_local(async move {
        // await rodio's stop BEFORE loading the video into mpv, so the
        // two are never both active (audio wouldn't visibly overlap a
        // video, but it WOULD keep playing under it otherwise).
        if let Some(player) = stop_first {
            let _ = player.send(PlayerCmd::Stop).await;
        }
        let Some(path) = resolve_video_path(&video).await else {
            let _ = tx.send(AppAction::VideoPlayerEvent(VideoEvent::Error {
                message: format!("no playable file for {title} (skipping)"),
            }));
            let _ = tx.send(AppAction::MusicEvent(MusicEvent::Ended));
            return;
        };
        if let Err(e) = video_player
            .send(VideoCommand::Load {
                path,
                title: Some(title),
                start_seconds: None,
            })
            .await
        {
            let _ = tx.send(AppAction::VideoPlayerEvent(VideoEvent::Error { message: e }));
        }
    });
}

/// stops whichever regular queue-playback backend (rodio or mpv) was
/// active, without touching the queue itself - used when radio starts
/// (see `tty::radio::start`), which is mutually exclusive with regular
/// queue playback but must leave the queue's contents alone (unlike
/// `play_index`, which is a queue transition and folds the current
/// entry into history).
pub fn stop_for_radio(app: &mut App) {
    if app.state.ephemeral.music.queue_video_active || app.state.ephemeral.music.audio_fallback_active
    {
        close_video(app);
    } else if let Some(player) = app.player.clone() {
        tokio::task::spawn_local(async move {
            let _ = player.send(PlayerCmd::Stop).await;
        });
    }
    app.state.ephemeral.music.player_state = PlayerState::Stopped;
}

/// stop/dismiss mpv - used when the queue advances away from a
/// video entry (to a song, or off the end of the queue) so it
/// doesn't keep showing/playing under the next thing.
fn close_video(app: &mut App) {
    let Some(video_player) = app.video_player.clone() else {
        return;
    };
    app.state
        .ephemeral
        .video_player
        .apply_command(&VideoCommand::Close);
    tokio::task::spawn_local(async move {
        let _ = video_player.send(VideoCommand::Close).await;
    });
}

/// advance to the next entry in the queue, if any. drives both the
/// `n` key and the `MusicEvent::Ended`/queue-driven `VideoEvent::
/// Ended` auto-advance paths.
pub fn play_next(app: &mut App, tx: &mpsc::UnboundedSender<AppAction>) {
    let next = app
        .state
        .ephemeral
        .music
        .current
        .map(|c| c + 1)
        .unwrap_or(0);
    play_index(app, next, tx);
}

/// step back to the most recently finished entry in `history`, if any
/// (re-inserting it at the front of the queue) - otherwise replays the
/// current entry from the top. queue entries are removed once played
/// (see `play_index`), so "previous" only has something to go back to
/// if history has an entry.
pub fn play_previous(app: &mut App, tx: &mpsc::UnboundedSender<AppAction>) {
    let m = &mut app.state.ephemeral.music;
    if let Some(prev) = m.history.first().cloned() {
        m.history.remove(0);
        m.queue.insert(0, prev);
    }
    play_index(app, 0, tx);
}

/// removes the queue entry at `index` (wire convention: index 0 =
/// currently playing, matching `m.queue`'s own layout - see the
/// module doc). removing index 0 stops whatever's actively loaded and
/// advances to whatever now sits at index 0 (or clears playback state
/// if nothing's left) via `play_index` - reused as-is rather than
/// duplicated, since it already handles both cases correctly. NOT
/// counted as "played" (unlike a normal skip/advance): the entry is
/// already gone from `m.queue` by the time `play_index` runs, so
/// there's nothing left for it to drain into history. removing any
/// other index just drops it from the upcoming list, no playback
/// impact.
pub fn remove_from_queue(app: &mut App, index: usize, tx: &mpsc::UnboundedSender<AppAction>) {
    let m = &mut app.state.ephemeral.music;
    if index >= m.queue.len() {
        return;
    }
    m.queue.remove(index);
    if index == 0 {
        play_index(app, 0, tx);
    }
}

/// moves the entry at `from_index` to `to_index` (wire convention:
/// index 0 = currently playing). refuses to touch index 0 as either
/// source or destination - reordering can only rearrange the UPCOMING
/// part of the queue, never swap out what's actually loaded into the
/// active backend right now.
pub fn reorder_queue(app: &mut App, from_index: usize, to_index: usize) {
    let m = &mut app.state.ephemeral.music;
    if from_index == 0 || to_index == 0 || from_index == to_index {
        return;
    }
    if from_index >= m.queue.len() || to_index >= m.queue.len() {
        return;
    }
    let entry = m.queue.remove(from_index);
    m.queue.insert(to_index, entry);
}

/// replace the queue with `songs` (audio-only - local browse/search/
/// collection loads never produce video entries) and start playing
/// from `start`.
pub fn play_now(
    app: &mut App,
    songs: Vec<SongRow>,
    start: usize,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    set_queue_entries(app, songs.into_iter().map(QueueEntry::Song).collect(), start, tx);
}

/// append `songs` to the end of the queue. if nothing is currently
/// loaded, starts playback at the first appended row.
pub fn enqueue_now(app: &mut App, songs: Vec<SongRow>, tx: &mpsc::UnboundedSender<AppAction>) {
    append_queue_entries(app, songs.into_iter().map(QueueEntry::Song).collect(), tx);
}

/// replaces the unified queue with `entries` (audio and/or video -
/// see `QueueEntry`) and starts playing from `start`. the single
/// entry point both local audio-only queueing (`play_now` above) and
/// a remote controller's `replace_queue` push
/// (`AppAction::PairingReplaceQueue`) funnel through, so both cases
/// share one "what's actually loaded/current" source of truth.
pub fn set_queue_entries(
    app: &mut App,
    entries: Vec<QueueEntry>,
    start: usize,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    app.state.ephemeral.music.queue = entries;
    play_index(app, start, tx);
}

/// appends `entries` to the unified queue without disturbing what's
/// currently playing - starts playback only if the queue was
/// previously empty/idle. shared by `enqueue_now` (audio-only) and a
/// remote controller's `append_queue` push
/// (`AppAction::PairingAppendQueue`).
pub fn append_queue_entries(
    app: &mut App,
    entries: Vec<QueueEntry>,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    if entries.is_empty() {
        return;
    }
    let m = &mut app.state.ephemeral.music;
    let was_empty_or_idle = m.current.is_none();
    let start = m.queue.len();
    m.queue.extend(entries);
    if was_empty_or_idle {
        play_index(app, start, tx);
    }
}

/// resolve a row's playable file path (local_path or media_blob),
/// with no rodio-specific filtering - shared by `resolve_playable_path`
/// (rodio path, applies the blocklist below) and the mpv fallback
/// (mpv doesn't have rodio's m4a bug, so it must NOT apply that
/// blocklist too - `try_mpv_audio_fallback` calling the blocklisted
/// version here was a real bug: it made an m4a track un-fallback-able,
/// blocked twice in a row instead of once).
async fn resolve_song_path(s: &SongRow) -> Option<String> {
    if let Some(p) = s.local_path.clone() {
        return Some(p);
    }
    let blob_id = s.media_blob_id.as_deref()?;
    super::player::resolve_paths(&[blob_id.to_string()])
        .await
        .into_iter()
        .next()
}

/// resolve a row's playable file path (local_path or media_blob).
/// also filters out file extensions known to crash rodio 0.20's
/// symphonia adapter on init seek (currently `.m4a`).
async fn resolve_playable_path(s: &SongRow) -> Option<String> {
    let path = resolve_song_path(s).await?;
    if is_known_unplayable(&path) {
        tracing::warn!(
            target: "rathole::tty::player",
            path = %path,
            "skipping unplayable file (known rodio/symphonia panic on init seek)"
        );
        return None;
    }
    Some(path)
}

/// extension-based blocklist. rodio 0.20 + symphonia's m4a demuxer
/// hits `unreachable!("Seek errors should not occur during init")`
/// on a meaningful fraction of real-world files; we'd rather skip
/// them than spam the panic hook.
fn is_known_unplayable(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".m4a")
}

/// resolve a queued video row's playable file path - same
/// local_path/media_blob_id fallback as `resolve_playable_path`, no
/// unplayable-extension blocklist (that's an rodio/symphonia-specific
/// issue).
async fn resolve_video_path(v: &QueuedVideoRow) -> Option<String> {
    if let Some(p) = v.local_path.clone() {
        return Some(p);
    }
    let blob_id = v.media_blob_id.as_deref()?;
    super::player::resolve_paths(&[blob_id.to_string()])
        .await
        .into_iter()
        .next()
}

/// play just the row under the cursor. queue is replaced with a
/// single-element vec so subsequent Next/Previous behave as
/// expected (no auto-advance into other library rows).
pub fn play_one_at_cursor(app: &mut App, tx: &mpsc::UnboundedSender<AppAction>) {
    let m = &app.state.ephemeral.music;
    if m.results.is_empty() {
        return;
    }
    let idx = m.results_cursor.min(m.results.len() - 1);
    let row = m.results[idx].clone();
    play_now(app, vec![row], 0, tx);
}

/// play the row under the cursor and queue everything after it.
/// bound to shift-A in the music view.
pub fn play_from_cursor(app: &mut App, tx: &mpsc::UnboundedSender<AppAction>) {
    let m = &app.state.ephemeral.music;
    if m.results.is_empty() {
        return;
    }
    let start = m.results_cursor.min(m.results.len() - 1);
    let queue: Vec<SongRow> = m.results[start..].to_vec();
    play_now(app, queue, 0, tx);
}

pub fn send_player(app: &App, cmd: PlayerCmd, tx: &mpsc::UnboundedSender<AppAction>) {
    let Some(player) = app.player.clone() else {
        return;
    };
    let tx = tx.clone();
    tokio::task::spawn_local(async move {
        if let Err(e) = player.send(cmd).await {
            let _ = tx.send(AppAction::MusicEvent(MusicEvent::Error(e)));
        }
    });
}

/// true when a real queued video, an mpv audio-fallback (rodio
/// couldn't decode the current song - see `try_mpv_audio_fallback`),
/// or an active radio session (`tty::radio`, also mpv-driven - see its
/// module doc) means mpv, not rodio, is actually driving playback
/// right now.
pub fn active_playback_is_video(app: &App) -> bool {
    app.state.ephemeral.music.queue_video_active
        || app.state.ephemeral.music.audio_fallback_active
        || app.state.ephemeral.radio.active
}

/// true if whichever backend is actually active (see
/// `active_playback_is_video`) reports itself as playing right now.
pub fn is_currently_playing(app: &App) -> bool {
    if active_playback_is_video(app) {
        app.state.ephemeral.video_player.state == VideoPlaybackState::Playing
    } else {
        app.state.ephemeral.music.player_state == PlayerState::Playing
    }
}

/// current playback position/duration in ms from whichever backend is
/// actually active (see `active_playback_is_video`) - mpv reports its
/// own position/duration separately from rodio's `MusicState` fields,
/// which otherwise sit frozen at whatever they last held while a
/// video (or an mpv audio-fallback) is playing.
pub fn current_position_and_duration_ms(app: &App) -> (u64, u64) {
    if active_playback_is_video(app) {
        let vp = &app.state.ephemeral.video_player;
        (
            (vp.position * 1000.0).round() as u64,
            vp.duration.map(|d| (d * 1000.0).round() as u64).unwrap_or(0),
        )
    } else {
        let m = &app.state.ephemeral.music;
        (m.position_ms, m.duration_ms)
    }
}

/// sends a generic (kind-less) playback command - pause/resume/seek/
/// volume - to whichever backend is actually active (see
/// `active_playback_is_video`). shared by every local key handler
/// (`on_player_row_key`/`on_player_pairing_key`) so pause etc. behave
/// the same regardless of whether rodio or an mpv audio-fallback is
/// currently driving the song - mirrors `tty::pairing::dispatch`'s own
/// `send_generic` (the wire-command equivalent).
pub fn send_generic_local(
    app: &App,
    tx: &mpsc::UnboundedSender<AppAction>,
    audio_cmd: PlayerCmd,
    video_cmd: VideoCommand,
) {
    if active_playback_is_video(app) {
        let Some(video_player) = app.video_player.clone() else {
            return;
        };
        tokio::task::spawn_local(async move {
            let _ = video_player.send(video_cmd).await;
        });
    } else {
        send_player(app, audio_cmd, tx);
    }
}

/// fetch playlist or album songs via transport, then replace the
/// queue and start playing from the first track. resolution +
/// loading happens lazily per-track via `play_index`, so a 200-row
/// album doesn't preload 200 decoders.
pub fn play_collection(
    app: &mut App,
    kind: &'static str,
    id: String,
    title: String,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    app.state.ephemeral.repl.status = Some(crate::ratcore::app::ReplStatus::info(format!(
        "loading {kind} {title}\u{2026}"
    )));
    let transport = app.transport.clone();
    let tx_outer = tx.clone();
    let title_for_event = title.clone();
    tokio::task::spawn_local(async move {
        let songs_result = match kind {
            "playlist" => transport.playlist_songs(&id).await,
            "album" => transport.album_songs(&id).await,
            other => Err(format!("unknown collection kind: {other}")),
        };
        let songs = match songs_result {
            Ok(s) => s,
            Err(e) => {
                let _ = tx_outer.send(AppAction::MusicEvent(MusicEvent::Error(format!(
                    "load {kind} failed: {e}"
                ))));
                return;
            }
        };
        if songs.is_empty() {
            let _ = tx_outer.send(AppAction::MusicEvent(MusicEvent::Error(format!(
                "{kind} {title_for_event} is empty"
            ))));
            return;
        }
        let _ = tx_outer.send(AppAction::CollectionLoaded { songs });
    });
    // mirror the queue locally so the player row reflects what's
    // about to play. the actual song rows arrive via the
    // CollectionLoaded action which calls play_now.
    let m = &mut app.state.ephemeral.music;
    m.queue.clear();
    m.current = None;
    m.position_ms = 0;
    m.duration_ms = 0;
}

/// fetch playlist or album songs and append them to the existing
/// queue without interrupting the currently-playing track. queue
/// extension is rathole-side; the audio thread is unaffected.
pub fn enqueue_collection(
    app: &mut App,
    kind: &'static str,
    id: String,
    title: String,
    tx: &mpsc::UnboundedSender<AppAction>,
) {
    app.state.ephemeral.repl.status = Some(crate::ratcore::app::ReplStatus::info(format!(
        "queueing {kind} {title}\u{2026}"
    )));
    let transport = app.transport.clone();
    let tx_outer = tx.clone();
    let title_for_event = title.clone();
    tokio::task::spawn_local(async move {
        let songs_result = match kind {
            "playlist" => transport.playlist_songs(&id).await,
            "album" => transport.album_songs(&id).await,
            other => Err(format!("unknown collection kind: {other}")),
        };
        let songs = match songs_result {
            Ok(s) => s,
            Err(e) => {
                let _ = tx_outer.send(AppAction::MusicEvent(MusicEvent::Error(format!(
                    "queue {kind} failed: {e}"
                ))));
                return;
            }
        };
        if songs.is_empty() {
            let _ = tx_outer.send(AppAction::MusicEvent(MusicEvent::Error(format!(
                "{kind} {title_for_event} is empty"
            ))));
            return;
        }
        let _ = tx_outer.send(AppAction::CollectionEnqueued { songs });
    });
}

/// resolve a song row (looked up by title via the search index) and
/// append it to the queue. used by the per-row "add to queue" action
/// when the row is a single song. matches `play_song` semantics by
/// re-searching the title and using the top hit.
pub fn enqueue_song_by_title(app: &mut App, title: String, tx: &mpsc::UnboundedSender<AppAction>) {
    if title.is_empty() {
        return;
    }
    app.state.ephemeral.repl.status = Some(crate::ratcore::app::ReplStatus::info(format!(
        "queueing {title}\u{2026}"
    )));
    let transport = app.transport.clone();
    let tx_outer = tx.clone();
    tokio::task::spawn_local(async move {
        let songs = match transport.search_songs(&title, 1).await {
            Ok(rows) => rows,
            Err(e) => {
                let _ = tx_outer.send(AppAction::MusicEvent(MusicEvent::Error(format!(
                    "queue search failed: {e}"
                ))));
                return;
            }
        };
        let Some(song) = songs.into_iter().next() else {
            let _ = tx_outer.send(AppAction::MusicEvent(MusicEvent::Error(format!(
                "no match for {title}"
            ))));
            return;
        };
        let _ = tx_outer.send(AppAction::CollectionEnqueued { songs: vec![song] });
    });
}
