//! OS media session integration (MPRIS on linux, SMTC on windows,
//! `MPNowPlayingInfoCenter` on macOS) via the `playwire` crate, for the
//! rodio audio and gstreamer video paths - neither gets a
//! `navigator.mediaSession` for free the way the webview's own
//! `<audio>`/`<video>` elements do. only constructed when
//! `use_rodio_playback` is on (that flag also gates the gst video window,
//! despite its name - see `app_config.rs`).
//!
//! grimoire's rodio player and the gst video window both only ever know
//! file paths/commands, never song/video metadata - spume is the only
//! thing that knows titles/artists/artwork, so it pushes that via the
//! `media_session_set_track` command whenever the "now playing" item
//! changes. play/pause/position/duration fold in automatically from each
//! backend's own event stream (`on_rodio_event` / `on_video_event`,
//! called from `player_commands.rs`'s event pump and
//! `video_window::emit_event` respectively).
//!
//! inbound direction (an OS media key or the shell's media widget) is
//! deliberately dumb on the rust side: it just re-emits a
//! `freqhole:media_session_action` tauri event and lets spume's existing
//! queue-aware action handlers (already wired for the browser's own
//! `navigator.mediaSession`) decide what that means and which backend it
//! applies to - next/previous/stop are queue concepts spume already owns,
//! not something either backend's own command set fully covers.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use grimoire::player::{PlayerEvent, PlayerState as RodioPlayerState};
use playwire::{Capabilities, Event, MediaControls, PlaybackState, PlayerConfig, Repeat, Track};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tracing::warn;

use crate::video_window::backend::VideoEvent;

/// the tauri event spume listens on to react to os media keys / the shell's
/// media widget. keep in sync with wherever spume subscribes.
pub const MEDIA_SESSION_ACTION_EVENT: &str = "freqhole:media_session_action";

#[derive(Debug, Clone, Default)]
struct TrackMeta {
    id: String,
    title: String,
    artist: String,
    album: String,
    artwork_url: String,
}

/// mutable mirror of what's currently playing, folded together from
/// spume's metadata pushes and whichever backend's events are arriving.
/// `playwire::MediaControls::set_state` cheaply no-ops on unchanged
/// fields, so republishing on every event is fine.
struct SessionState {
    controls: Mutex<MediaControls>,
    track: Mutex<TrackMeta>,
    playing: Mutex<bool>,
    position: Mutex<Duration>,
    duration: Mutex<Option<Duration>>,
}

static SESSION: OnceLock<Option<SessionState>> = OnceLock::new();

/// serializable subset of `playwire::Event` forwarded to spume. only the
/// variants spume can actually act on - shuffle/repeat/openuri/raise/quit
/// aren't meaningful concepts here.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum MediaSessionAction {
    Play,
    Pause,
    PlayPause,
    Stop,
    Next,
    Previous,
    SeekTo { ms: u64 },
    SetVolume { volume: f64 },
}

/// get-or-init the session, constructing `MediaControls` lazily on first
/// use. `None` if `use_rodio_playback` is off, or if the platform's media
/// service is unavailable - playwire's own docs recommend treating every
/// `MediaControls::new` error as "run without media controls" rather than
/// a fatal condition, so a missing d-bus session (linux ssh sessions,
/// some ci sandboxes) or similar just quietly disables this feature.
fn ensure_started(app: &AppHandle) -> Option<&'static SessionState> {
    SESSION
        .get_or_init(|| {
            let enabled = crate::app_config::FreqholeAppConfig::load(app)
                .map(|c| c.use_rodio_playback)
                .unwrap_or_else(crate::app_config::default_use_rodio_playback);
            // TEMP(media-session): loud, level-independent print so this is
            // visible even if the tracing subscriber is filtering warn/info -
            // remove once the mac test confirms the feature works end to end.
            eprintln!("[media-session] ensure_started: use_rodio_playback={enabled}");
            if !enabled {
                eprintln!("[media-session] disabled by config - not constructing MediaControls");
                return None;
            }

            let config = PlayerConfig::new("freqhole").desktop_entry("net.freqhole.freqhole");
            let app_for_events = app.clone();
            let controls = match MediaControls::new(config, move |event| {
                eprintln!("[media-session] event from OS: {event:?}");
                handle_action(&app_for_events, event);
            }) {
                Ok(c) => {
                    eprintln!("[media-session] MediaControls::new succeeded");
                    c
                }
                Err(e) => {
                    eprintln!("[media-session] MediaControls::new FAILED: {e}");
                    warn!(error = %e, "media session unavailable - continuing without OS media controls");
                    return None;
                }
            };

            Some(SessionState {
                controls: Mutex::new(controls),
                track: Mutex::new(TrackMeta::default()),
                playing: Mutex::new(false),
                position: Mutex::new(Duration::ZERO),
                duration: Mutex::new(None),
            })
        })
        .as_ref()
}

/// called from `playwire`'s event handler - runs on a platform-owned
/// thread (a d-bus worker on linux, a WinRT pool thread on windows, the
/// main run loop on macOS). must not block and must not call back into
/// `set_state` here (playwire's own docs warn against this) - just hand
/// the action off to spume, which already knows how to route it to
/// whichever backend (rodio or gst video) is actually playing.
fn handle_action(app: &AppHandle, event: Event) {
    let action = match event {
        Event::Play => MediaSessionAction::Play,
        Event::Pause => MediaSessionAction::Pause,
        Event::PlayPause => MediaSessionAction::PlayPause,
        Event::Stop => MediaSessionAction::Stop,
        Event::Next => MediaSessionAction::Next,
        Event::Previous => MediaSessionAction::Previous,
        Event::SeekTo(d) => MediaSessionAction::SeekTo {
            ms: d.as_millis() as u64,
        },
        Event::SeekBy(secs) => {
            let Some(session) = SESSION.get().and_then(|s| s.as_ref()) else {
                return;
            };
            let current = *session.position.lock().unwrap();
            let target_ms = (current.as_millis() as f64 + secs * 1000.0).max(0.0) as u64;
            MediaSessionAction::SeekTo { ms: target_ms }
        }
        Event::SetVolume(v) => MediaSessionAction::SetVolume { volume: v },
        _ => return,
    };
    if let Err(e) = app.emit(MEDIA_SESSION_ACTION_EVENT, &action) {
        warn!(error = %e, "failed to emit media session action to webview");
    }
}

/// republish the merged state to the OS. cheap to call often - playwire
/// diffs against the previous snapshot internally.
fn republish(session: &SessionState) {
    let track = session.track.lock().unwrap().clone();
    let playing = *session.playing.lock().unwrap();
    let position = *session.position.lock().unwrap();
    let duration = *session.duration.lock().unwrap();

    // TEMP(media-session): see ensure_started's note - remove once confirmed working.
    eprintln!(
        "[media-session] republish: title={:?} playing={playing} position={position:?} duration={duration:?}",
        track.title
    );

    if track.id.is_empty() {
        eprintln!("[media-session] republish: skipped, no track id set yet");
        return;
    }

    let state = PlaybackState {
        track: Some(Track {
            id: track.id,
            title: track.title,
            artists: vec![track.artist],
            album: track.album,
            artwork_url: track.artwork_url,
            url: String::new(),
        }),
        playing,
        position,
        duration,
        volume: 1.0,
        repeat: Repeat::Off,
        shuffle: false,
        capabilities: Capabilities {
            can_go_next: true,
            can_go_previous: true,
            can_seek: true,
        },
    };

    if let Ok(mut controls) = session.controls.lock() {
        if let Err(e) = controls.set_state(&state) {
            eprintln!("[media-session] set_state FAILED: {e}");
            warn!(error = %e, "failed to publish media session state");
        } else {
            eprintln!("[media-session] set_state ok");
        }
    }
}

/// spume calls this (via the `media_session_set_track` tauri command)
/// whenever the "now playing" item changes - the only source of song/
/// video metadata, since neither backend carries any.
pub fn set_track(
    app: &AppHandle,
    id: String,
    title: String,
    artist: String,
    album: String,
    artwork_url: String,
) {
    // TEMP(media-session): see ensure_started's note - remove once confirmed working.
    eprintln!("[media-session] set_track: id={id} title={title:?} artist={artist:?}");
    let Some(session) = ensure_started(app) else {
        eprintln!("[media-session] set_track: no session (disabled or unavailable)");
        return;
    };
    *session.track.lock().unwrap() = TrackMeta {
        id,
        title,
        artist,
        album,
        artwork_url,
    };
    republish(session);
}

/// clears the current track (nothing playing) - e.g. queue emptied,
/// player stopped.
pub fn clear_track(app: &AppHandle) {
    let Some(session) = ensure_started(app) else {
        return;
    };
    *session.track.lock().unwrap() = TrackMeta::default();
    *session.playing.lock().unwrap() = false;
    republish(session);
}

/// fold a rodio `PlayerEvent` into the merged playback state.
pub fn on_rodio_event(app: &AppHandle, event: &PlayerEvent) {
    let Some(session) = ensure_started(app) else {
        return;
    };
    match event {
        PlayerEvent::State { state } => {
            *session.playing.lock().unwrap() = *state == RodioPlayerState::Playing;
        }
        PlayerEvent::Progress { ms, total_ms } => {
            *session.position.lock().unwrap() = Duration::from_millis(*ms);
            *session.duration.lock().unwrap() = Some(Duration::from_millis(*total_ms));
        }
        PlayerEvent::Ended => {
            *session.playing.lock().unwrap() = false;
        }
        _ => return,
    }
    republish(session);
}

/// fold a gst video window `VideoEvent` into the merged playback state.
pub fn on_video_event(app: &AppHandle, event: &VideoEvent) {
    let Some(session) = ensure_started(app) else {
        return;
    };
    match event {
        VideoEvent::Playing => *session.playing.lock().unwrap() = true,
        VideoEvent::Paused => *session.playing.lock().unwrap() = false,
        VideoEvent::Position { seconds } => {
            *session.position.lock().unwrap() = Duration::from_secs_f64((*seconds).max(0.0));
        }
        VideoEvent::Duration { seconds } => {
            *session.duration.lock().unwrap() = Some(Duration::from_secs_f64((*seconds).max(0.0)));
        }
        VideoEvent::Ended | VideoEvent::Closed => {
            *session.playing.lock().unwrap() = false;
        }
        _ => return,
    }
    republish(session);
}

/// tauri command: spume pushes "now playing" metadata whenever it
/// changes (song or video, local or remote - spume already resolved
/// title/artist/album/artwork by the time it calls this).
#[tauri::command]
pub fn media_session_set_track(
    app: AppHandle,
    id: String,
    title: String,
    artist: String,
    album: String,
    artwork_url: String,
) {
    set_track(&app, id, title, artist, album, artwork_url);
}

/// tauri command: spume calls this when nothing is playing (queue
/// emptied, player stopped/closed).
#[tauri::command]
pub fn media_session_clear_track(app: AppHandle) {
    clear_track(&app);
}
