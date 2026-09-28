// linux separate video window, backed by `mpv` (spawned as a subprocess,
// controlled over its own json ipc socket) instead of gstreamer/gtk - an
// escape hatch for `[video].linux_use_mpv = true` in config, for systems
// where gstreamer's pipewire audio sink stutters no matter how the
// pipeline is tuned (see gst.rs's own doc comments for that whole saga).
//
// mpv owns its own native window entirely outside of this process's gtk
// setup, so unlike gst.rs there's no gtk-main-thread affinity to respect
// here - state is protected by a plain `Mutex` rather than a `thread_local!`,
// and commands are handled on a background thread rather than marshalled
// onto any particular thread.

use std::io::{BufRead, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Wry};

use super::backend::{classify_error, PlayerState, VideoCommand, VideoEvent};
use super::VideoWindowDiagnostics;

struct MpvWindow {
    child: Child,
    socket: UnixStream,
    socket_path: PathBuf,
    state: PlayerState,
}

static WINDOW: Mutex<Option<MpvWindow>> = Mutex::new(None);
// the user's last explicit fullscreen/windowed choice, remembered across
// loads and window recreation - same convention (and same default) as
// gst.rs's `DEFAULT_FULLSCREEN` thread_local. unlike gst.rs, nothing here
// ever applied this on load at all, so mpv windows opened small and never
// actually went fullscreen - see `open_or_reuse`'s fix below.
static DEFAULT_FULLSCREEN: AtomicBool = AtomicBool::new(true);

/// validate that `mpv` is installed and runnable, without opening a window.
pub fn diagnostics() -> VideoWindowDiagnostics {
    match std::process::Command::new("mpv").arg("--version").output() {
        Ok(output) if output.status.success() => VideoWindowDiagnostics {
            available: true,
            // reused for mpv's own version string - the field predates
            // this backend and is gstreamer-specific in name only.
            gstreamer_version: String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .map(str::to_string),
            playbin3_available: false,
            gtksink_available: false,
            gtkglsink_available: false,
            error: None,
            available_audio_sinks: Vec::new(),
        },
        Ok(output) => VideoWindowDiagnostics {
            available: false,
            gstreamer_version: None,
            playbin3_available: false,
            gtksink_available: false,
            gtkglsink_available: false,
            error: Some(String::from_utf8_lossy(&output.stderr).to_string()),
            available_audio_sinks: Vec::new(),
        },
        Err(e) => VideoWindowDiagnostics {
            available: false,
            gstreamer_version: None,
            playbin3_available: false,
            gtksink_available: false,
            gtkglsink_available: false,
            error: Some(format!("mpv is not installed or not on PATH: {e}")),
            available_audio_sinks: Vec::new(),
        },
    }
}

/// entry point from the tauri command. every command runs on a background
/// thread and reports failures asynchronously via `VideoEvent::Error`,
/// mirroring `gst::dispatch`'s fire-and-forget shape (there just to marshal
/// onto gtk's main thread; here to keep slow mpv startup/ipc off whatever
/// thread tauri used to invoke this command).
pub fn dispatch(app: AppHandle<Wry>, command: VideoCommand) -> Result<(), String> {
    std::thread::spawn(move || {
        if let Err(e) = handle_command(&app, command) {
            super::emit_event(
                &app,
                &VideoEvent::Error {
                    error_type: classify_error(&e).to_string(),
                    message: e,
                },
            );
        }
    });
    Ok(())
}

fn handle_command(app: &AppHandle<Wry>, command: VideoCommand) -> Result<(), String> {
    match command {
        VideoCommand::Close => {
            close_window();
            Ok(())
        }
        VideoCommand::Load {
            path,
            title,
            start_seconds,
        } => open_or_reuse(app, &path, title.as_deref(), start_seconds),
        // mpv just follows whatever the system/pipewire default sink is -
        // device selection isn't wired up for this backend yet.
        VideoCommand::ListOutputDevices => {
            super::emit_event(
                app,
                &VideoEvent::OutputDevices {
                    devices: Vec::new(),
                },
            );
            Ok(())
        }
        VideoCommand::SetOutputDevice { .. } => {
            Err("switching output devices isn't supported with the mpv player yet".to_string())
        }
        other => {
            let mut guard = WINDOW
                .lock()
                .map_err(|_| "mpv window lock poisoned".to_string())?;
            let w = guard
                .as_mut()
                .ok_or_else(|| "no video window is open".to_string())?;
            // resolve toggles against real state before touching mpv, same
            // convention as gst.rs's `handle_on_main`.
            let resolved = match other {
                VideoCommand::TogglePlay => w.state.resolve_toggle(),
                VideoCommand::ToggleFullscreen => VideoCommand::SetFullscreen {
                    fullscreen: !w.state.fullscreen,
                },
                c => c,
            };
            w.state.apply_command(&resolved);
            apply(w, &resolved)
        }
    }
}

fn apply(w: &mut MpvWindow, command: &VideoCommand) -> Result<(), String> {
    match command {
        VideoCommand::Play => send(
            w,
            serde_json::json!({"command": ["set_property", "pause", false]}),
        ),
        VideoCommand::Pause => send(
            w,
            serde_json::json!({"command": ["set_property", "pause", true]}),
        ),
        VideoCommand::Seek { seconds } => send(
            w,
            serde_json::json!({"command": ["seek", seconds, "absolute"]}),
        ),
        VideoCommand::SetVolume { volume } => send(
            w,
            serde_json::json!({"command": ["set_property", "volume", volume * 100.0]}),
        ),
        VideoCommand::SetFullscreen { fullscreen } => {
            DEFAULT_FULLSCREEN.store(*fullscreen, Ordering::Relaxed);
            send(
                w,
                serde_json::json!({"command": ["set_property", "fullscreen", fullscreen]}),
            )
        }
        // Close is handled by `close_window()` before reaching here; Load
        // and device commands are handled before this point; toggles are
        // resolved by the caller.
        VideoCommand::Close
        | VideoCommand::Load { .. }
        | VideoCommand::TogglePlay
        | VideoCommand::ToggleFullscreen
        | VideoCommand::ListOutputDevices
        | VideoCommand::SetOutputDevice { .. } => Ok(()),
    }
}

fn send(w: &mut MpvWindow, value: serde_json::Value) -> Result<(), String> {
    let mut line = value.to_string();
    line.push('\n');
    w.socket
        .write_all(line.as_bytes())
        .map_err(|e| format!("failed to write mpv command: {e}"))
}

/// open the window (spawning mpv on first use) and start the given file.
fn open_or_reuse(
    app: &AppHandle<Wry>,
    path: &str,
    title: Option<&str>,
    start_seconds: Option<f64>,
) -> Result<(), String> {
    let already_open = WINDOW
        .lock()
        .map_err(|_| "mpv window lock poisoned".to_string())?
        .is_some();
    if !already_open {
        spawn_mpv(app, title)?;
    }

    tracing::info!(path, title = ?title, "video_window: mpv loading");
    let start_option = start_seconds
        .filter(|s| *s > 0.0)
        .map(|s| format!("start={s}"));

    let mut guard = WINDOW
        .lock()
        .map_err(|_| "mpv window lock poisoned".to_string())?;
    let w = guard
        .as_mut()
        .ok_or_else(|| "mpv failed to start".to_string())?;
    w.state = PlayerState::default();
    w.state.apply_command(&VideoCommand::Load {
        path: path.to_string(),
        title: title.map(str::to_string),
        start_seconds,
    });
    // mpv's real signature is `loadfile <url> [<flags> [<index> [<options>]]]`
    // - <index> (playlist insertion position, only meaningful for the
    // insert-at flag) sits BEFORE <options>, so passing our start= option
    // directly as the 4th array element (as this used to do) actually lands
    // in the <index> slot, which fails to parse as an integer ("argument
    // index can't be parsed: option requires parameter"). per mpv's own
    // docs, -1 is the required placeholder for index when a later argument
    // (options) needs to be set. omit both entirely when there's no start
    // position, since they're only optional trailing arguments.
    let command = match start_option {
        Some(options) => {
            serde_json::json!({"command": ["loadfile", path, "replace", -1, options]})
        }
        None => serde_json::json!({"command": ["loadfile", path, "replace"]}),
    };
    send(w, command)?;
    // `apply_command`'s Load arm resets `fullscreen` to `false` (same
    // `..PlayerState::default()` spread convention as gst.rs) - reapply the
    // user's remembered choice after that reset on every load, or every
    // load would silently stay windowed regardless of what was last chosen.
    let fullscreen = DEFAULT_FULLSCREEN.load(Ordering::Relaxed);
    w.state.fullscreen = fullscreen;
    send(
        w,
        serde_json::json!({"command": ["set_property", "fullscreen", fullscreen]}),
    )
}

/// spawn mpv, connect to its ipc socket (retrying briefly - the socket
/// file appears asynchronously after the process starts), and start the
/// background thread that turns its event stream into `VideoEvent`s.
fn spawn_mpv(app: &AppHandle<Wry>, title: Option<&str>) -> Result<(), String> {
    let socket_path = std::env::temp_dir().join(format!("charnel-mpv-{}.sock", std::process::id()));
    let _ = std::fs::remove_file(&socket_path);

    let mut child = std::process::Command::new("mpv")
        .arg("--idle=yes")
        .arg("--force-window=immediate")
        .arg(format!("--input-ipc-server={}", socket_path.display()))
        .arg("--geometry=960x540")
        .arg(format!("--title={}", title.unwrap_or("video")))
        // "warn" (not mpv's quieter defaults) keeps real failures (missing
        // vo/ao, codec errors, failed seeks) visible in the piped stdout/
        // stderr logged below - previously inherited from charnel's own
        // stdout/stderr (often /dev/null-equivalent under a gui launcher),
        // so mpv failing silently was indistinguishable from it actually
        // working with nothing to show/play.
        .arg("--msg-level=all=warn")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start mpv (is it installed?): {e}"))?;

    // `.take()` (not moving the field directly) - `child` itself is still
    // needed whole below, to live inside `MpvWindow`.
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || log_mpv_output(stdout, "stdout"));
    }
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || log_mpv_output(stderr, "stderr"));
    }

    let mut socket = None;
    for _ in 0..50 {
        if let Ok(s) = UnixStream::connect(&socket_path) {
            socket = Some(s);
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let socket = socket.ok_or_else(|| "mpv did not open its control socket in time".to_string())?;
    let reader_socket = socket
        .try_clone()
        .map_err(|e| format!("failed to clone mpv's control socket: {e}"))?;

    {
        let mut guard = WINDOW
            .lock()
            .map_err(|_| "mpv window lock poisoned".to_string())?;
        *guard = Some(MpvWindow {
            child,
            socket,
            socket_path,
            state: PlayerState::default(),
        });
        // subscribe to the properties this backend's `VideoEvent`s need -
        // ids are cosmetic (replies are ignored), only the resulting
        // property-change events matter here.
        if let Some(w) = guard.as_mut() {
            for (id, prop) in [
                (1, "time-pos"),
                (2, "duration"),
                (3, "pause"),
                (4, "fullscreen"),
            ] {
                let _ = send(
                    w,
                    serde_json::json!({"command": ["observe_property", id, prop]}),
                );
            }
            // real per-file demux/decode failure detail only ever shows up
            // as a `log-message` ipc event, not on mpv's own stdout/stderr,
            // even at `--msg-level=all=warn` - confirmed against rathole's
            // own `MpvPlayer` (client/rathole/src/tty/video_player.rs),
            // which hit the same thing first. handled in `read_mpv_events`.
            let _ = send(
                w,
                serde_json::json!({"command": ["request_log_messages", "v"]}),
            );
        }
    }

    let app_for_reader = app.clone();
    std::thread::spawn(move || read_mpv_events(app_for_reader, reader_socket));
    tracing::info!("video_window: mpv started");
    Ok(())
}

/// forwards mpv's own stdout/stderr into `tracing` line-by-line - see the
/// `--msg-level` doc comment above for why this exists.
fn log_mpv_output(stream: impl std::io::Read, stream_name: &'static str) {
    let mut lines = std::io::BufReader::new(stream).lines();
    while let Some(Ok(line)) = lines.next() {
        tracing::warn!(mpv_stream = stream_name, %line, "video_window: mpv output");
    }
}

fn read_mpv_events(app: AppHandle<Wry>, socket: UnixStream) {
    let reader = std::io::BufReader::new(socket);
    for line in reader.lines() {
        let Ok(line) = line else { break };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let Some(event) = value.get("event").and_then(|e| e.as_str()) else {
            continue;
        };
        match event {
            "property-change" => handle_property_change(&app, &value),
            // the officially-recommended way to detect natural end of
            // playback - the `eof-reached` property is timing-sensitive
            // and can fire spuriously per mpv's own docs.
            "end-file" => match value.get("reason").and_then(|r| r.as_str()) {
                Some("eof") => emit_state(&app, VideoEvent::Ended),
                // previously silently ignored - a load/decode failure
                // (missing codec, corrupt file, unsupported container)
                // surfaces exactly here, as "error" with a `file_error`
                // reason, and nowhere else the ui could see. this was
                // almost certainly why a failed load looked like nothing
                // happened at all (window opens, nothing plays, no error).
                Some("error") => {
                    let message = value
                        .get("file_error")
                        .and_then(|e| e.as_str())
                        .unwrap_or("mpv failed to play this file")
                        .to_string();
                    emit_state(
                        &app,
                        VideoEvent::Error {
                            error_type: classify_error(&message).to_string(),
                            message,
                        },
                    );
                }
                _ => {}
            },
            // real per-file demux/decode error detail (see the
            // `request_log_messages` subscription in `spawn_mpv`) - logged
            // rather than surfaced as a `VideoEvent::Error` since most of
            // these are routine/verbose status lines, not failures; the
            // `end-file`/`error` branch above is what actually reaches the ui.
            "log-message" => {
                let level = value.get("level").and_then(|l| l.as_str()).unwrap_or("?");
                let prefix = value.get("prefix").and_then(|p| p.as_str()).unwrap_or("?");
                let text = value.get("text").and_then(|t| t.as_str()).unwrap_or("");
                tracing::warn!(
                    level,
                    prefix,
                    text = text.trim_end(),
                    "video_window: mpv log"
                );
            }
            "shutdown" => break,
            _ => {}
        }
    }
    // reached when the socket closes (mpv exited, whether from our own
    // `close_window()` or the user closing mpv's window directly). if
    // `close_window()` already cleared this, skip re-emitting `Closed`.
    let mut guard = match WINDOW.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if guard.is_some() {
        *guard = None;
        drop(guard);
        super::emit_event(&app, &VideoEvent::Closed);
    }
}

fn handle_property_change(app: &AppHandle<Wry>, value: &serde_json::Value) {
    let Some(name) = value.get("name").and_then(|n| n.as_str()) else {
        return;
    };
    let data = value.get("data");
    match name {
        "time-pos" => {
            if let Some(seconds) = data.and_then(|d| d.as_f64()) {
                emit_state(app, VideoEvent::Position { seconds });
            }
        }
        "duration" => {
            if let Some(seconds) = data.and_then(|d| d.as_f64()) {
                emit_state(app, VideoEvent::Duration { seconds });
            }
        }
        "pause" => {
            if let Some(paused) = data.and_then(|d| d.as_bool()) {
                emit_state(
                    app,
                    if paused {
                        VideoEvent::Paused
                    } else {
                        VideoEvent::Playing
                    },
                );
            }
        }
        "fullscreen" => {
            if let Some(fullscreen) = data.and_then(|d| d.as_bool()) {
                emit_state(app, VideoEvent::Fullscreen { fullscreen });
            }
        }
        _ => {}
    }
}

/// fold into local state and only emit when something actually changed,
/// mirroring `gst::emit_state`.
fn emit_state(app: &AppHandle<Wry>, event: VideoEvent) {
    let changed = match WINDOW.lock() {
        Ok(mut guard) => match guard.as_mut() {
            Some(w) => w.state.apply(&event),
            None => true,
        },
        Err(_) => true,
    };
    if changed {
        super::emit_event(app, &event);
    }
}

fn close_window() {
    let mut guard = match WINDOW.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if let Some(mut w) = guard.take() {
        let _ = send(&mut w, serde_json::json!({"command": ["quit"]}));
        let _ = w.child.kill();
        let _ = std::fs::remove_file(&w.socket_path);
    }
}

/// kill any live mpv subprocess on app shutdown - unlike `gst.rs`'s window
/// (in-process GTK widgets, which simply vanish with the process), mpv is
/// a genuinely separate OS process with no built-in "die with parent"
/// behavior (`std::process::Child` has no `kill_on_drop`, unlike the
/// tokio `Child` `radio_mpv.rs` uses) - it was observed staying open after
/// charnel itself quit. same cleanup as an explicit user-initiated close,
/// just also called from `RunEvent::Exit` in `lib.rs`.
pub fn shutdown() {
    close_window();
}
