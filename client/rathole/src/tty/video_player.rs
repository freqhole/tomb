//! mpv-backed `VideoPlayer` impl for the tty shell.
//!
//! spawns the `mpv` binary with its json ipc socket enabled
//! (`--input-ipc-server`), sends `VideoCommand`s as ipc requests, and
//! translates mpv's own event/property-change stream back into
//! `AppAction::VideoPlayerEvent`s — mirrors exactly how
//! `tty::player::RodioPlayer` bridges grimoire's rodio controller.
//!
//! kept as a single long-lived `mpv --idle=yes` process rather than
//! respawning per file, so video playback and still-image display
//! (pairing qr, album art) share one process/socket, per
//! docs/rathole-headless-player-plan.md.
//!
//! linux is the real target (`--vo=drm`); the video output is
//! configurable so this can be exercised against a plain windowed
//! `mpv` on any dev machine that has it installed (see the `#[ignore]`
//! integration test at the bottom, meant to be run manually — CI has
//! no `mpv` binary).

use async_trait::async_trait;
use serde_json::{json, Value as JsonValue};
use std::process::Stdio;
use std::rc::Rc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex as AsyncMutex};

use crate::ratcore::app::{AppAction, AudioDeviceInfo, VideoCommand, VideoEvent};
use crate::ratcore::transport::VideoPlayer;

/// `observe_property` ids assigned at connect time — arbitrary but
/// must stay stable so property-change events can be told apart.
const OBS_PAUSE: u64 = 1;
const OBS_TIME_POS: u64 = 2;
const OBS_DURATION: u64 = 3;
/// fixed `request_id` for `ListAudioDevices` round trips. v1
/// simplification: only one such request is ever expected in flight
/// at a time, so a single well-known id is enough to correlate mpv's
/// response back to `VideoEvent::AudioDevices`.
const REQ_LIST_AUDIO_DEVICES: u64 = 1000;

/// how long to keep retrying the ipc socket connect after spawning
/// mpv (it creates the socket file asynchronously, shortly after
/// start).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const CONNECT_RETRY_INTERVAL: Duration = Duration::from_millis(25);

pub struct MpvPlayer {
    // `kill_on_drop(true)` (set at spawn) means dropping this `Child`
    // (i.e. the last `Rc<MpvPlayer>` going away) sends mpv a kill
    // signal — found via the manual integration test below that
    // `VideoCommand::Close` (mpv's `stop` command) only stops
    // playback and leaves the idle process running; without this,
    // every spawned mpv would leak past the end of the rathole
    // process.
    _child: Child,
    write_half: AsyncMutex<tokio::net::unix::OwnedWriteHalf>,
}

impl MpvPlayer {
    /// spawn mpv targeting the platform's default video output
    /// (`drm` on linux, mpv's own default elsewhere — a plain window,
    /// useful for local dev/testing since drm needs no X/wayland but
    /// also isn't exercisable on a mac dev machine).
    pub async fn spawn(action_tx: mpsc::UnboundedSender<AppAction>) -> Result<Rc<Self>, String> {
        Self::spawn_with_video_output(action_tx, default_video_output()).await
    }

    /// spawn mpv with an explicit `--vo` driver. split out from
    /// [`Self::spawn`] so tests (and any future config override) can
    /// force e.g. `"null"` (no visible output at all) instead of
    /// popping a real window/claiming the drm device.
    pub async fn spawn_with_video_output(
        action_tx: mpsc::UnboundedSender<AppAction>,
        video_output: &str,
    ) -> Result<Rc<Self>, String> {
        let socket_path =
            std::env::temp_dir().join(format!("rathole-mpv-{}.sock", ulid::Ulid::new()));

        let child = Command::new("mpv")
            .arg("--idle=yes")
            .arg("--force-window=no")
            .arg(format!("--vo={video_output}"))
            .arg("--no-terminal")
            .arg("--really-quiet")
            .arg(format!(
                "--input-ipc-server={}",
                socket_path.to_string_lossy()
            ))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("failed to spawn mpv: {e}"))?;

        let stream = connect_with_retry(&socket_path).await?;
        let (read_half, write_half) = stream.into_split();

        // observe the three properties the ui cares about; mpv
        // replies with `property-change` events from here on.
        let write_half = AsyncMutex::new(write_half);
        send_ipc_locked(
            &write_half,
            json!({"command": ["observe_property", OBS_PAUSE, "pause"]}),
        )
        .await?;
        send_ipc_locked(
            &write_half,
            json!({"command": ["observe_property", OBS_TIME_POS, "time-pos"]}),
        )
        .await?;
        send_ipc_locked(
            &write_half,
            json!({"command": ["observe_property", OBS_DURATION, "duration"]}),
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

/// background task: reads newline-delimited json from mpv's ipc
/// socket and forwards translated `VideoEvent`s onto `action_tx`.
/// exits (dropping its half of the socket) once the socket closes,
/// i.e. once mpv itself exits.
async fn reader_loop(
    read_half: tokio::net::unix::OwnedReadHalf,
    action_tx: mpsc::UnboundedSender<AppAction>,
) {
    let mut lines = BufReader::new(read_half).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                if line.trim().is_empty() {
                    continue;
                }
                let Ok(msg) = serde_json::from_str::<JsonValue>(&line) else {
                    tracing::warn!(target: "video_player", %line, "mpv ipc: unparseable line");
                    continue;
                };
                for ev in translate(&msg) {
                    if action_tx.send(AppAction::VideoPlayerEvent(ev)).is_err() {
                        return;
                    }
                }
            }
            Ok(None) => {
                // socket closed — mpv exited (or was killed).
                let _ = action_tx.send(AppAction::VideoPlayerEvent(VideoEvent::Closed));
                return;
            }
            Err(e) => {
                tracing::warn!(target: "video_player", error = %e, "mpv ipc: read error");
                let _ = action_tx.send(AppAction::VideoPlayerEvent(VideoEvent::Error {
                    message: format!("mpv ipc read error: {e}"),
                }));
                return;
            }
        }
    }
}

/// translate one mpv ipc json message into zero or more `VideoEvent`s.
/// zero for messages we don't care about (e.g. unrelated request
/// acks); mpv's protocol is one-message-per-line so this never needs
/// to buffer partial state across calls.
fn translate(msg: &JsonValue) -> Vec<VideoEvent> {
    // response to a request we made (has "request_id", no "event").
    if let Some(request_id) = msg.get("request_id").and_then(JsonValue::as_u64) {
        if request_id == REQ_LIST_AUDIO_DEVICES {
            let is_success = msg.get("error").and_then(JsonValue::as_str) == Some("success");
            if !is_success {
                let message = msg
                    .get("error")
                    .and_then(JsonValue::as_str)
                    .unwrap_or("unknown mpv error")
                    .to_string();
                return vec![VideoEvent::Error { message }];
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
            return vec![VideoEvent::AudioDevices { devices }];
        }
        return Vec::new();
    }

    let Some(event) = msg.get("event").and_then(JsonValue::as_str) else {
        return Vec::new();
    };
    match event {
        "property-change" => {
            let id = msg.get("id").and_then(JsonValue::as_u64);
            let data = msg.get("data");
            match id {
                Some(OBS_PAUSE) => match data.and_then(JsonValue::as_bool) {
                    Some(true) => vec![VideoEvent::Paused],
                    Some(false) => vec![VideoEvent::Playing],
                    None => Vec::new(),
                },
                Some(OBS_TIME_POS) => data
                    .and_then(JsonValue::as_f64)
                    .map(|seconds| vec![VideoEvent::Position { seconds }])
                    .unwrap_or_default(),
                Some(OBS_DURATION) => data
                    .and_then(JsonValue::as_f64)
                    .map(|seconds| vec![VideoEvent::Duration { seconds }])
                    .unwrap_or_default(),
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
                vec![VideoEvent::Error { message }]
            }
            _ => vec![VideoEvent::Ended],
        },
        "shutdown" => vec![VideoEvent::Closed],
        _ => Vec::new(),
    }
}

#[async_trait(?Send)]
impl VideoPlayer for MpvPlayer {
    async fn send(&self, cmd: VideoCommand) -> Result<(), String> {
        match cmd {
            VideoCommand::Load {
                path,
                title: _,
                start_seconds,
            } => {
                let mut args = vec![
                    JsonValue::String("loadfile".into()),
                    JsonValue::String(path),
                    JsonValue::String("replace".into()),
                ];
                if let Some(secs) = start_seconds {
                    args.push(JsonValue::String(format!("start={secs}")));
                }
                self.send_ipc(json!({ "command": args })).await
            }
            VideoCommand::LoadQueue { paths } => {
                // mpv's own playlist: `replace` for the first entry (clears
                // whatever was loaded and starts playing it), `append` for
                // the rest - a real multi-item queue, not just one file.
                for (i, path) in paths.into_iter().enumerate() {
                    let mode = if i == 0 { "replace" } else { "append" };
                    self.send_ipc(json!({"command": ["loadfile", path, mode]}))
                        .await?;
                }
                Ok(())
            }
            VideoCommand::Enqueue { paths } => {
                // plain `append` (never `append-play`): mpv's own "was the
                // playlist empty" idle check has no idea rathole's rodio
                // backend might already be playing audio concurrently -
                // `append-play` would start this video immediately even
                // while a song is actively playing. whether a genuinely
                // idle player should auto-start the first appended item is
                // decided explicitly by `tty::pairing::append_queue`, not
                // by mpv's own local idle heuristic.
                for path in paths {
                    self.send_ipc(json!({"command": ["loadfile", path, "append"]}))
                        .await?;
                }
                Ok(())
            }
            VideoCommand::Next => self.send_ipc(json!({"command": ["playlist-next"]})).await,
            VideoCommand::Previous => self.send_ipc(json!({"command": ["playlist-prev"]})).await,
            VideoCommand::ShowImage { path } => {
                // keep showing the image until explicitly replaced/
                // closed, rather than mpv's default single-frame
                // duration.
                self.send_ipc(json!({
                    "command": [
                        "loadfile", path, "replace", "image-display-duration=inf"
                    ]
                }))
                .await
            }
            VideoCommand::Play => {
                self.send_ipc(json!({"command": ["set_property", "pause", false]}))
                    .await
            }
            VideoCommand::Pause => {
                self.send_ipc(json!({"command": ["set_property", "pause", true]}))
                    .await
            }
            VideoCommand::TogglePlay => self.send_ipc(json!({"command": ["cycle", "pause"]})).await,
            VideoCommand::Seek { seconds } => {
                self.send_ipc(json!({"command": ["set_property", "time-pos", seconds]}))
                    .await
            }
            VideoCommand::SetVolume { volume } => {
                // VideoCommand::SetVolume is 0.0..=1.0; mpv's `volume`
                // property is a 0..100 percentage.
                self.send_ipc(json!({
                    "command": ["set_property", "volume", volume * 100.0]
                }))
                .await
            }
            VideoCommand::ListAudioDevices => {
                self.send_ipc(json!({
                    "command": ["get_property", "audio-device-list"],
                    "request_id": REQ_LIST_AUDIO_DEVICES,
                }))
                .await
            }
            VideoCommand::SetAudioDevice { name } => {
                self.send_ipc(json!({"command": ["set_property", "audio-device", name]}))
                    .await
            }
            VideoCommand::Close => self.send_ipc(json!({"command": ["stop"]})).await,
        }
    }
}

fn default_video_output() -> &'static str {
    if cfg!(target_os = "linux") {
        "drm"
    } else {
        // no drm outside linux; fall back to mpv's own default
        // (a plain window) so this is still exercisable in local dev.
        "gpu-next"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translate_pause_property_change() {
        let msg = json!({"event":"property-change","id":OBS_PAUSE,"name":"pause","data":true});
        assert_eq!(translate(&msg), vec![VideoEvent::Paused]);
        let msg = json!({"event":"property-change","id":OBS_PAUSE,"name":"pause","data":false});
        assert_eq!(translate(&msg), vec![VideoEvent::Playing]);
    }

    #[test]
    fn translate_time_pos_and_duration() {
        let msg =
            json!({"event":"property-change","id":OBS_TIME_POS,"name":"time-pos","data":12.5});
        assert_eq!(
            translate(&msg),
            vec![VideoEvent::Position { seconds: 12.5 }]
        );
        let msg =
            json!({"event":"property-change","id":OBS_DURATION,"name":"duration","data":100.0});
        assert_eq!(
            translate(&msg),
            vec![VideoEvent::Duration { seconds: 100.0 }]
        );
    }

    #[test]
    fn translate_end_file_eof_vs_error() {
        let msg = json!({"event":"end-file","reason":"eof"});
        assert_eq!(translate(&msg), vec![VideoEvent::Ended]);

        let msg = json!({"event":"end-file","reason":"error","file_error":"no decoder"});
        assert_eq!(
            translate(&msg),
            vec![VideoEvent::Error {
                message: "no decoder".into()
            }]
        );
    }

    #[test]
    fn translate_shutdown() {
        let msg = json!({"event":"shutdown"});
        assert_eq!(translate(&msg), vec![VideoEvent::Closed]);
    }

    #[test]
    fn translate_audio_device_list_response() {
        let msg = json!({
            "request_id": REQ_LIST_AUDIO_DEVICES,
            "error": "success",
            "data": [
                {"name": "alsa/hw:0,0", "description": "bcm2835 HDMI 1"},
                {"name": "alsa/hw:1,0", "description": "bcm2835 Headphones"},
            ]
        });
        assert_eq!(
            translate(&msg),
            vec![VideoEvent::AudioDevices {
                devices: vec![
                    AudioDeviceInfo {
                        name: "alsa/hw:0,0".into(),
                        description: "bcm2835 HDMI 1".into(),
                    },
                    AudioDeviceInfo {
                        name: "alsa/hw:1,0".into(),
                        description: "bcm2835 Headphones".into(),
                    },
                ]
            }]
        );
    }

    #[test]
    fn translate_unrelated_message_is_empty() {
        let msg = json!({"event":"some-future-event-we-dont-handle"});
        assert!(translate(&msg).is_empty());
    }

    /// real integration test — spawns an actual `mpv` process and
    /// exercises it over the ipc socket. `#[ignore]`d because CI has
    /// no `mpv` binary; run manually with `cargo test -- --ignored`
    /// on a machine that has mpv installed (confirmed working via
    /// this test on macOS with mpv 0.41.0, using `--vo=null` so no
    /// window pops up).
    #[tokio::test(flavor = "current_thread")]
    #[ignore = "requires a real mpv binary; run manually with `cargo test -- --ignored`"]
    async fn spawns_mpv_and_shows_a_test_image() {
        let local = tokio::task::LocalSet::new();
        local
            .run_until(async {
                let (tx, mut rx) = mpsc::unbounded_channel::<AppAction>();
                let player = MpvPlayer::spawn_with_video_output(tx, "null")
                    .await
                    .expect("mpv should spawn and its ipc socket should connect");

                // 1x1 white pixel png, valid enough for mpv to decode.
                let png_bytes: &[u8] = &[
                    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49,
                    0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02,
                    0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44,
                    0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F, 0x00, 0x05, 0xFE, 0x02,
                    0xFE, 0xDC, 0xCC, 0x59, 0xE7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
                    0xAE, 0x42, 0x60, 0x82,
                ];
                let img_path = std::env::temp_dir().join("rathole-mpv-test.png");
                std::fs::write(&img_path, png_bytes).unwrap();

                player
                    .send(VideoCommand::ShowImage {
                        path: img_path.to_string_lossy().into_owned(),
                    })
                    .await
                    .expect("send should succeed");

                // expect at least one event (typically a pause
                // property-change) within a generous timeout.
                let got = tokio::time::timeout(Duration::from_secs(5), rx.recv())
                    .await
                    .expect("should receive a video event before timing out")
                    .expect("channel should not close");
                match got {
                    AppAction::VideoPlayerEvent(_) => {}
                    other => panic!("expected a VideoPlayerEvent, got {other:?}"),
                }

                player.send(VideoCommand::Close).await.unwrap();
            })
            .await;
    }
}
