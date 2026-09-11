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

/// load and play the entry at `m.queue[idx]`. clears any prior
/// position state; audio entries resolve + `PlayerCmd::Load` (rodio),
/// video entries resolve + `VideoCommand::Load` (mpv). on resolve
/// failure the task emits an error event followed by
/// `MusicEvent::Ended` so the auto-advance handler skips past the
/// broken entry, same for both kinds.
pub fn play_index(app: &mut App, idx: usize, tx: &mpsc::UnboundedSender<AppAction>) {
    let was_video_active = app.state.ephemeral.music.queue_video_active;
    if idx >= app.state.ephemeral.music.queue.len() {
        // ran off the end of the queue. mirror what
        // MusicEvent::Ended would do.
        let m = &mut app.state.ephemeral.music;
        m.current = None;
        m.position_ms = 0;
        m.duration_ms = 0;
        m.player_state = PlayerState::Stopped;
        m.queue_video_active = false;
        if was_video_active {
            close_video(app);
        }
        return;
    }
    app.state.ephemeral.music.current = Some(idx);
    app.state.ephemeral.music.position_ms = 0;
    app.state.ephemeral.music.duration_ms = 0;
    let entry = app.state.ephemeral.music.queue[idx].clone();

    match entry {
        QueueEntry::Song(row) => {
            app.state.ephemeral.music.player_state = PlayerState::Loading;
            app.state.ephemeral.music.queue_video_active = false;
            if was_video_active {
                close_video(app);
            }
            play_song_entry(app, row, tx);
        }
        QueueEntry::Video(video) => {
            app.state.ephemeral.music.player_state = PlayerState::Stopped;
            app.state.ephemeral.music.queue_video_active = true;
            // stop rodio so audio doesn't keep playing under the video.
            if let Some(player) = app.player.clone() {
                tokio::task::spawn_local(async move {
                    let _ = player.send(PlayerCmd::Stop).await;
                });
            }
            play_video_entry(app, video, tx);
        }
    }
}

fn play_song_entry(app: &mut App, row: SongRow, tx: &mpsc::UnboundedSender<AppAction>) {
    let Some(player) = app.player.clone() else {
        app.state.ephemeral.music.last_event_error =
            Some("no audio backend in this shell".to_string());
        return;
    };
    let title = row.title.clone();
    let tx = tx.clone();
    tokio::task::spawn_local(async move {
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

fn play_video_entry(app: &mut App, video: QueuedVideoRow, tx: &mpsc::UnboundedSender<AppAction>) {
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

/// step back one entry in the queue. clamps at 0; if nothing is
/// playing yet, plays the first entry.
pub fn play_previous(app: &mut App, tx: &mpsc::UnboundedSender<AppAction>) {
    let prev = app
        .state
        .ephemeral
        .music
        .current
        .map(|c| c.saturating_sub(1))
        .unwrap_or(0);
    play_index(app, prev, tx);
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

/// resolve a row's playable file path (local_path or media_blob).
/// also filters out file extensions known to crash rodio 0.20's
/// symphonia adapter on init seek (currently `.m4a`).
async fn resolve_playable_path(s: &SongRow) -> Option<String> {
    let candidate = if let Some(p) = s.local_path.clone() {
        Some(p)
    } else if let Some(blob_id) = s.media_blob_id.as_deref() {
        super::player::resolve_paths(&[blob_id.to_string()])
            .await
            .into_iter()
            .next()
    } else {
        None
    };
    let path = candidate?;
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
