//! mpv-backed `MusicPlayer` impl for the tty shell.
//!
//! shells out to a long-lived `mpv --idle=yes --vid=no
//! --input-ipc-server=...` audio-only process rather than linking
//! grimoire's in-process libmpv2 audio backend, so rathole never needs
//! `libmpv-dev`/`libmpv.so` to even boot (mpv alone is the only runtime
//! dependency, same as `tty::video_player`'s existing mpv subprocess for
//! video). the ipc wire plumbing below (connect-with-retry,
//! observe_property, request/reply correlation, audio-device listing)
//! mirrors `tty::video_player`'s own closely - adapted rather than
//! shared outright, since the properties/commands/events each cares
//! about differ enough (playlist position + path for `TrackChanged`
//! here, no window/geometry concerns at all) that a forced-shared
//! abstraction wasn't obviously worth it yet.
//!
//! still resolves `media_blob_id`s to filesystem paths via grimoire's
//! media_blobz service - that's the one remaining grimoire dependency
//! here, unrelated to libmpv2/the audio backend itself.
//!
//! known simplification vs. grimoire's in-process backend: `Enqueue`
//! always uses plain `append` (never `append-play`), matching
//! `tty::video_player`'s own `Enqueue` handling - whether a genuinely
//! idle player should auto-start the first appended item is decided
//! explicitly by higher-level queue/pairing logic, not by mpv's local
//! idle heuristic.
//!
//! unix-only: mpv ipc control here relies on `tokio::net::UnixStream`,
//! which doesn't exist on windows. `tty/mod.rs` swaps in
//! `player_stub.rs` (same public `MpvPlayer::spawn` signature, always
//! errors - `run.rs` already treats a failed spawn as a normal, handled
//! case) there instead - see that file's own doc comment, and
//! `tty::video_player`'s identical split, for the full reasoning.
//! `resolve_paths` below has nothing unix-specific about it and is
//! duplicated verbatim in the stub rather than stubbed out, so path
//! resolution still works on non-unix platforms too.
#![cfg(unix)]

use async_trait::async_trait;
use serde_json::{json, Value as JsonValue};
use std::process::Stdio;
use std::rc::Rc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex as AsyncMutex};

use crate::ratcore::app::{AppAction, AudioDeviceInfo, MusicEvent, PlayerState};
use crate::ratcore::transport::{MusicPlayer, PlayerCmd};

const OBS_PAUSE: u64 = 1;
const OBS_TIME_POS: u64 = 2;
const OBS_DURATION: u64 = 3;
const OBS_PLAYLIST_POS: u64 = 4;
const OBS_PATH: u64 = 5;
/// fixed `request_id` for `ListOutputDevices` round trips - see
/// `tty::video_player`'s identical constant for why a single
/// well-known id is enough (v1 simplification: only one such request
/// expected in flight at a time).
const REQ_LIST_AUDIO_DEVICES: u64 = 1000;

/// see `tty::video_player`'s identical constants for why these values:
/// generous on purpose, a loaded pi competing with iroh/sqlite etc can
/// take noticeably longer to get mpv's socket up than a quiet manual
/// test.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_RETRY_INTERVAL: Duration = Duration::from_millis(25);

pub struct MpvPlayer {
    // `kill_on_drop(true)` (set at spawn) - see `tty::video_player`'s
    // identical field/comment for why this matters (mpv's own `stop`
    // command only halts playback, not the idle process itself).
    _child: Child,
    write_half: AsyncMutex<tokio::net::unix::OwnedWriteHalf>,
}

impl MpvPlayer {
    /// spawn an audio-only mpv (`--vid=no`, no window ever opens) using
    /// the configured `media.mpv_path` (defaults to bare `"mpv"` via
    /// PATH).
    pub async fn spawn(action_tx: mpsc::UnboundedSender<AppAction>) -> Result<Rc<Self>, String> {
        let mpv_path = grimoire::config::get_config().media.mpv_path.clone();
        let socket_path =
            std::env::temp_dir().join(format!("rathole-mpv-audio-{}.sock", ulid::Ulid::new()));

        tracing::info!(target: "player", %mpv_path, socket = %socket_path.display(), "spawning mpv (audio)");

        let mut child = Command::new(&mpv_path)
            .arg("--idle=yes")
            .arg("--vid=no")
            .arg("--no-terminal")
            .arg("--msg-level=all=warn")
            .arg(format!(
                "--input-ipc-server={}",
                socket_path.to_string_lossy()
            ))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("failed to spawn mpv ({mpv_path}): {e}"))?;

        if let Some(stdout) = child.stdout.take() {
            tokio::task::spawn_local(super::video_player::log_mpv_output(stdout, "stdout"));
        }
        if let Some(stderr) = child.stderr.take() {
            tokio::task::spawn_local(super::video_player::log_mpv_output(stderr, "stderr"));
        }

        let stream = connect_with_retry(&socket_path).await?;
        let (read_half, write_half) = stream.into_split();
        let write_half = AsyncMutex::new(write_half);

        for (id, name) in [
            (OBS_PAUSE, "pause"),
            (OBS_TIME_POS, "time-pos"),
            (OBS_DURATION, "duration"),
            (OBS_PLAYLIST_POS, "playlist-pos"),
            (OBS_PATH, "path"),
        ] {
            send_ipc_locked(
                &write_half,
                json!({"command": ["observe_property", id, name]}),
            )
            .await?;
        }
        // per-file demux/decode failure detail - see
        // `tty::video_player`'s identical call for why this isn't
        // optional (mpv's stdout/stderr stays quiet about this even at
        // `--msg-level=all=warn`).
        send_ipc_locked(
            &write_half,
            json!({"command": ["request_log_messages", "v"]}),
        )
        .await?;

        tokio::task::spawn_local(reader_loop(read_half, action_tx));

        Ok(Rc::new(Self {
            _child: child,
            write_half,
        }))
    }

    async fn send_ipc(&self, cmd: JsonValue) -> Result<(), String> {
        send_ipc_locked(&self.write_half, cmd).await
    }
}

async fn send_ipc_locked(
    write_half: &AsyncMutex<tokio::net::unix::OwnedWriteHalf>,
    cmd: JsonValue,
) -> Result<(), String> {
    let mut line = serde_json::to_vec(&cmd).map_err(|e| e.to_string())?;
    line.push(b'\n');
    let mut w = write_half.lock().await;
    w.write_all(&line)
        .await
        .map_err(|e| format!("mpv ipc write failed: {e}"))
}

async fn connect_with_retry(socket_path: &std::path::Path) -> Result<UnixStream, String> {
    let deadline = tokio::time::Instant::now() + CONNECT_TIMEOUT;
    loop {
        match UnixStream::connect(socket_path).await {
            Ok(stream) => return Ok(stream),
            Err(e) => {
                if tokio::time::Instant::now() >= deadline {
                    return Err(format!(
                        "timed out connecting to mpv ipc socket at {}: {e}",
                        socket_path.display()
                    ));
                }
                tokio::time::sleep(CONNECT_RETRY_INTERVAL).await;
            }
        }
    }
}

/// background task: reads newline-delimited json from mpv's ipc socket
/// and forwards translated `MusicEvent`s onto `action_tx`. tracks the
/// last-known `time-pos`/`duration`/`playlist-pos`/`path` locally (mpv
/// reports each property-change independently, one per line) so
/// `Progress`/`TrackChanged` can be assembled once enough of the
/// picture is known, mirroring how `tty::video_player`'s reader loop
/// has no need to (it has no `TrackChanged` equivalent, one file at a
/// time).
async fn reader_loop(
    read_half: tokio::net::unix::OwnedReadHalf,
    action_tx: mpsc::UnboundedSender<AppAction>,
) {
    let mut last_time_pos: Option<f64> = None;
    let mut last_duration: Option<f64> = None;
    let mut last_playlist_pos: Option<i64> = None;
    let mut last_path: Option<String> = None;

    let mut lines = BufReader::new(read_half).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                if line.trim().is_empty() {
                    continue;
                }
                let Ok(msg) = serde_json::from_str::<JsonValue>(&line) else {
                    tracing::warn!(target: "player", %line, "mpv ipc: unparseable line");
                    continue;
                };
                for ev in translate(
                    &msg,
                    &mut last_time_pos,
                    &mut last_duration,
                    &mut last_playlist_pos,
                    &mut last_path,
                ) {
                    if action_tx.send(AppAction::MusicEvent(ev)).is_err() {
                        return;
                    }
                }
            }
            Ok(None) => {
                let _ = action_tx.send(AppAction::MusicEvent(MusicEvent::State(
                    PlayerState::Stopped,
                )));
                return;
            }
            Err(e) => {
                tracing::warn!(target: "player", error = %e, "mpv ipc: read error");
                let _ = action_tx.send(AppAction::MusicEvent(MusicEvent::Error(format!(
                    "mpv ipc read error: {e}"
                ))));
                return;
            }
        }
    }
}

/// translate one mpv ipc json message into zero or more `MusicEvent`s,
/// given (and updating) the reader loop's cached last-known property
/// values.
fn translate(
    msg: &JsonValue,
    last_time_pos: &mut Option<f64>,
    last_duration: &mut Option<f64>,
    last_playlist_pos: &mut Option<i64>,
    last_path: &mut Option<String>,
) -> Vec<MusicEvent> {
    if let Some(request_id) = msg.get("request_id").and_then(JsonValue::as_u64) {
        if request_id == REQ_LIST_AUDIO_DEVICES {
            let is_success = msg.get("error").and_then(JsonValue::as_str) == Some("success");
            if !is_success {
                let message = msg
                    .get("error")
                    .and_then(JsonValue::as_str)
                    .unwrap_or("unknown mpv error")
                    .to_string();
                return vec![MusicEvent::Error(message)];
            }
            let devices = msg
                .get("data")
                .and_then(JsonValue::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|d| {
                            let name = d.get("name")?.as_str()?.to_string();
                            let description = d
                                .get("description")
                                .and_then(JsonValue::as_str)
                                .unwrap_or(&name)
                                .to_string();
                            Some(AudioDeviceInfo { name, description })
                        })
                        .collect()
                })
                .unwrap_or_default();
            return vec![MusicEvent::OutputDevices { devices }];
        }
        return Vec::new();
    }

    let Some(event) = msg.get("event").and_then(JsonValue::as_str) else {
        return Vec::new();
    };
    match event {
        "log-message" => {
            let level = msg.get("level").and_then(JsonValue::as_str).unwrap_or("?");
            let prefix = msg.get("prefix").and_then(JsonValue::as_str).unwrap_or("?");
            let text = msg.get("text").and_then(JsonValue::as_str).unwrap_or("");
            tracing::warn!(target: "player", %level, %prefix, text = text.trim_end(), "mpv log");
            Vec::new()
        }
        "property-change" => {
            let id = msg.get("id").and_then(JsonValue::as_u64);
            let data = msg.get("data");
            match id {
                Some(OBS_PAUSE) => match data.and_then(JsonValue::as_bool) {
                    Some(true) => vec![MusicEvent::State(PlayerState::Paused)],
                    Some(false) => vec![MusicEvent::State(PlayerState::Playing)],
                    None => Vec::new(),
                },
                Some(OBS_TIME_POS) => {
                    *last_time_pos = data.and_then(JsonValue::as_f64);
                    progress_event(*last_time_pos, *last_duration)
                }
                Some(OBS_DURATION) => {
                    *last_duration = data.and_then(JsonValue::as_f64);
                    progress_event(*last_time_pos, *last_duration)
                }
                Some(OBS_PLAYLIST_POS) => {
                    *last_playlist_pos = data.and_then(JsonValue::as_i64);
                    track_changed_event(*last_playlist_pos, last_path)
                }
                Some(OBS_PATH) => {
                    *last_path = data.and_then(JsonValue::as_str).map(str::to_string);
                    track_changed_event(*last_playlist_pos, last_path)
                }
                _ => Vec::new(),
            }
        }
        "end-file" => match msg.get("reason").and_then(JsonValue::as_str) {
            Some("error") => {
                let message = msg
                    .get("file_error")
                    .and_then(JsonValue::as_str)
                    .unwrap_or("playback failed")
                    .to_string();
                vec![MusicEvent::Error(message)]
            }
            _ => vec![MusicEvent::Ended],
        },
        "shutdown" => vec![MusicEvent::State(PlayerState::Stopped)],
        _ => Vec::new(),
    }
}

fn progress_event(time_pos: Option<f64>, duration: Option<f64>) -> Vec<MusicEvent> {
    match (time_pos, duration) {
        (Some(ms_f), Some(total_f)) if ms_f.is_finite() && total_f.is_finite() => {
            vec![MusicEvent::Progress {
                ms: (ms_f * 1000.0).max(0.0) as u64,
                total_ms: (total_f * 1000.0).max(0.0) as u64,
            }]
        }
        _ => Vec::new(),
    }
}

fn track_changed_event(playlist_pos: Option<i64>, path: &Option<String>) -> Vec<MusicEvent> {
    match (playlist_pos, path) {
        (Some(index), Some(path)) if index >= 0 && !path.is_empty() => {
            vec![MusicEvent::TrackChanged {
                index: index as usize,
                path: path.clone(),
            }]
        }
        _ => Vec::new(),
    }
}

#[async_trait(?Send)]
impl MusicPlayer for MpvPlayer {
    async fn send(&self, cmd: PlayerCmd) -> Result<(), String> {
        match cmd {
            PlayerCmd::Load(paths) => {
                for (i, path) in paths.into_iter().enumerate() {
                    let mode = if i == 0 { "replace" } else { "append" };
                    self.send_ipc(json!({"command": ["loadfile", path, mode]}))
                        .await?;
                }
                Ok(())
            }
            PlayerCmd::Enqueue(paths) => {
                for path in paths {
                    self.send_ipc(json!({"command": ["loadfile", path, "append"]}))
                        .await?;
                }
                Ok(())
            }
            PlayerCmd::Play => {
                self.send_ipc(json!({"command": ["set_property", "pause", false]}))
                    .await
            }
            PlayerCmd::Pause => {
                self.send_ipc(json!({"command": ["set_property", "pause", true]}))
                    .await
            }
            PlayerCmd::Stop => self.send_ipc(json!({"command": ["stop"]})).await,
            PlayerCmd::Next => {
                self.send_ipc(json!({"command": ["playlist-next", "force"]}))
                    .await
            }
            PlayerCmd::Previous => {
                self.send_ipc(json!({"command": ["playlist-prev", "force"]}))
                    .await
            }
            PlayerCmd::Seek(ms) => {
                self.send_ipc(json!({"command": ["seek", ms as f64 / 1000.0, "absolute"]}))
                    .await
            }
            PlayerCmd::SetVolume(v) => {
                self.send_ipc(json!({"command": ["set_property", "volume", v * 100.0]}))
                    .await
            }
            PlayerCmd::ListOutputDevices => {
                self.send_ipc(json!({
                    "command": ["get_property", "audio-device-list"],
                    "request_id": REQ_LIST_AUDIO_DEVICES,
                }))
                .await
            }
            PlayerCmd::SetOutputDevice(name) => {
                self.send_ipc(json!({"command": ["set_property", "audio-device", name]}))
                    .await
            }
        }
    }
}

/// resolve a list of `media_blob_id`s to local filesystem paths via
/// grimoire's media_blobz service. ids without a `local_path` are
/// skipped (mpv needs files on disk; in-memory bytes aren't supported
/// by this backend today).
pub async fn resolve_paths(blob_ids: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(blob_ids.len());
    for id in blob_ids {
        match grimoire::media_blobz::get_media_blob_with_data(id).await {
            Ok((blob, _)) => {
                if let Some(path) = blob.local_path {
                    out.push(path);
                }
            }
            Err(e) => {
                tracing::warn!("media_blob {} resolve failed: {}", id, e);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translate_pause_property_change() {
        let (mut t, mut d, mut p, mut path) = (None, None, None, None);
        let msg = json!({"event":"property-change","id":OBS_PAUSE,"name":"pause","data":true});
        assert_eq!(
            translate(&msg, &mut t, &mut d, &mut p, &mut path),
            vec![MusicEvent::State(PlayerState::Paused)]
        );
    }

    #[test]
    fn translate_progress_needs_both_time_pos_and_duration() {
        let (mut t, mut d, mut p, mut path) = (None, None, None, None);
        let msg =
            json!({"event":"property-change","id":OBS_TIME_POS,"name":"time-pos","data":12.5});
        assert!(translate(&msg, &mut t, &mut d, &mut p, &mut path).is_empty());

        let msg =
            json!({"event":"property-change","id":OBS_DURATION,"name":"duration","data":100.0});
        assert_eq!(
            translate(&msg, &mut t, &mut d, &mut p, &mut path),
            vec![MusicEvent::Progress {
                ms: 12500,
                total_ms: 100000
            }]
        );
    }

    #[test]
    fn translate_track_changed_needs_both_pos_and_path() {
        let (mut t, mut d, mut p, mut path) = (None, None, None, None);
        let msg =
            json!({"event":"property-change","id":OBS_PLAYLIST_POS,"name":"playlist-pos","data":2});
        assert!(translate(&msg, &mut t, &mut d, &mut p, &mut path).is_empty());

        let msg =
            json!({"event":"property-change","id":OBS_PATH,"name":"path","data":"/tmp/song.flac"});
        assert_eq!(
            translate(&msg, &mut t, &mut d, &mut p, &mut path),
            vec![MusicEvent::TrackChanged {
                index: 2,
                path: "/tmp/song.flac".to_string()
            }]
        );
    }

    #[test]
    fn translate_end_file_eof_vs_error() {
        let (mut t, mut d, mut p, mut path) = (None, None, None, None);
        let msg = json!({"event":"end-file","reason":"eof"});
        assert_eq!(
            translate(&msg, &mut t, &mut d, &mut p, &mut path),
            vec![MusicEvent::Ended]
        );

        let msg = json!({"event":"end-file","reason":"error","file_error":"no decoder"});
        assert_eq!(
            translate(&msg, &mut t, &mut d, &mut p, &mut path),
            vec![MusicEvent::Error("no decoder".to_string())]
        );
    }

    #[test]
    fn translate_audio_device_list_response() {
        let (mut t, mut d, mut p, mut path) = (None, None, None, None);
        let msg = json!({
            "request_id": REQ_LIST_AUDIO_DEVICES,
            "error": "success",
            "data": [
                {"name": "alsa/hw:0,0", "description": "bcm2835 HDMI 1"},
            ]
        });
        assert_eq!(
            translate(&msg, &mut t, &mut d, &mut p, &mut path),
            vec![MusicEvent::OutputDevices {
                devices: vec![AudioDeviceInfo {
                    name: "alsa/hw:0,0".into(),
                    description: "bcm2835 HDMI 1".into(),
                }]
            }]
        );
    }
}
