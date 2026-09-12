//! unix domain socket listener for simple media-control commands -
//! e.g. physical buttons wired to a raspberry pi's GPIO pins,
//! forwarded by a small script that writes a line to the socket. off
//! by default; enable via `[control_socket]\nenabled = true` in
//! freqhole-config.toml (see `grimoire::config::ControlSocketConfig`),
//! or toggle it from the player-pairing settings screen (`u`) - see
//! docs/rathole-control-socket.md for the full protocol writeup.
//!
//! wire protocol: one command per line (newline-delimited). action
//! commands (`play_pause`, `next`, `previous`, `volume_up`,
//! `volume_down`, `stop`, `show_admin_pin`, `rotate_pin`,
//! `show_player`) are fire-and-forget - no reply is written back. two
//! query commands DO write a single-line JSON reply back on the same
//! connection: `get_state` (now-playing song/video, playing/paused,
//! position/duration, volume) and `list_audio_devices` (the active
//! backend's known output devices). `set_audio_device <name>` takes
//! the device name (the rest of the line after the first space) and
//! is fire-and-forget, same as the other action commands.
//!
//! unknown lines are logged and ignored rather than closing the
//! connection - a stray/malformed write from a flaky button script
//! shouldn't need a reconnect.

use tokio::sync::{mpsc, oneshot};

/// the fixed vocabulary of media-control commands the unix control
/// socket accepts, one per newline-delimited line (see this module's
/// own doc comment for the exact wire strings).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ControlSocketCommand {
    PlayPause,
    Next,
    Previous,
    VolumeUp,
    VolumeDown,
    Stop,
    /// rotates the pairing session pin AND marks the next pairing
    /// attempt using it for an admin-level grant (see
    /// `PairingStateReader::regenerate_admin_pin`), then shows the
    /// player-pairing overview so the new pin is visible.
    ShowAdminPin,
    /// rotates the pairing session pin (no admin grant), then shows
    /// the player-pairing overview so the new pin is visible.
    RotatePin,
    /// switches focus to the player-pairing overview (qr/art/queue),
    /// without touching the pin.
    ShowPlayer,
    /// query: replies with a JSON now-playing/volume snapshot.
    GetState,
    /// query: replies with a JSON list of the active backend's known
    /// audio output devices.
    ListAudioDevices,
    /// switches the active backend's audio output device (fire-and-
    /// forget, same as the other action commands).
    SetAudioDevice(String),
}

/// one request from a connected control-socket client, sent to the
/// main event loop over a dedicated channel (not `AppAction` - unlike
/// the rest of the app, this needs a reply channel for query
/// commands, and the whole feature is tty-only anyway).
pub struct ControlSocketRequest {
    pub command: ControlSocketCommand,
    /// query commands (`get_state`/`list_audio_devices`) send their
    /// JSON reply here; action commands leave this `None` and nothing
    /// is written back to the client.
    pub reply: Option<oneshot::Sender<String>>,
}

/// starts the listener if `[control_socket].enabled` is `true` in the
/// loaded config; otherwise does nothing (also a no-op on non-unix
/// targets, where `tokio::net::UnixListener` doesn't exist). best-
/// effort: a bind/remove failure is logged and leaves the feature
/// unavailable rather than failing the whole app's startup.
#[cfg(unix)]
pub fn maybe_spawn(request_tx: mpsc::UnboundedSender<ControlSocketRequest>) {
    let cfg = grimoire::config::get_config().control_socket;
    if !cfg.enabled {
        return;
    }
    let path = resolve_socket_path(cfg.socket_path);
    tokio::task::spawn_local(async move {
        if let Err(e) = run(path, request_tx).await {
            tracing::warn!(target: "rathole::tty::control_socket", error = %e, "control socket listener failed");
        }
    });
}

#[cfg(not(unix))]
pub fn maybe_spawn(_request_tx: mpsc::UnboundedSender<ControlSocketRequest>) {}

/// default socket path is `~/rathole-control.sock` (home dir, not the
/// grimoire data dir - deliberately outside the library so it's easy
/// for an external button-wiring script to find regardless of which
/// freqhole config/data dir is active) - `$HOME` is unix-only, matching
/// this module's own `#[cfg(unix)]` gating.
#[cfg(unix)]
fn resolve_socket_path(configured: Option<String>) -> std::path::PathBuf {
    if let Some(p) = configured {
        return std::path::PathBuf::from(p);
    }
    match std::env::var("HOME") {
        Ok(home) => std::path::PathBuf::from(home).join("rathole-control.sock"),
        Err(_) => std::path::PathBuf::from("rathole-control.sock"),
    }
}

#[cfg(unix)]
async fn run(
    path: std::path::PathBuf,
    request_tx: mpsc::UnboundedSender<ControlSocketRequest>,
) -> std::io::Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
    use tokio::net::UnixListener;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    // remove a stale socket file left behind by a previous, uncleanly
    // exited run - bind fails with "address in use" otherwise.
    let _ = tokio::fs::remove_file(&path).await;
    let listener = UnixListener::bind(&path)?;
    tracing::info!(target: "rathole::tty::control_socket", path = %path.display(), "control socket listening");
    loop {
        let (stream, _addr) = listener.accept().await?;
        let request_tx = request_tx.clone();
        tokio::task::spawn_local(async move {
            let (read_half, mut write_half) = stream.into_split();
            let mut lines = tokio::io::BufReader::new(read_half).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        let line = line.trim();
                        if line.is_empty() {
                            continue;
                        }
                        match parse_command(line) {
                            Some(command) => {
                                let needs_reply = matches!(
                                    command,
                                    ControlSocketCommand::GetState
                                        | ControlSocketCommand::ListAudioDevices
                                );
                                if needs_reply {
                                    let (reply_tx, reply_rx) = oneshot::channel();
                                    if request_tx
                                        .send(ControlSocketRequest {
                                            command,
                                            reply: Some(reply_tx),
                                        })
                                        .is_err()
                                    {
                                        break;
                                    }
                                    if let Ok(json) = reply_rx.await {
                                        if write_half
                                            .write_all(format!("{json}\n").as_bytes())
                                            .await
                                            .is_err()
                                        {
                                            break;
                                        }
                                    }
                                } else {
                                    let _ = request_tx.send(ControlSocketRequest {
                                        command,
                                        reply: None,
                                    });
                                }
                            }
                            None => {
                                tracing::warn!(target: "rathole::tty::control_socket", line, "unrecognized control socket command");
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(e) => {
                        tracing::warn!(target: "rathole::tty::control_socket", error = %e, "control socket read error");
                        break;
                    }
                }
            }
        });
    }
}

#[cfg(unix)]
fn parse_command(line: &str) -> Option<ControlSocketCommand> {
    let (word, rest) = match line.split_once(' ') {
        Some((w, r)) => (w, Some(r.trim())),
        None => (line, None),
    };
    match word {
        "play_pause" => Some(ControlSocketCommand::PlayPause),
        "next" => Some(ControlSocketCommand::Next),
        "previous" => Some(ControlSocketCommand::Previous),
        "volume_up" => Some(ControlSocketCommand::VolumeUp),
        "volume_down" => Some(ControlSocketCommand::VolumeDown),
        "stop" => Some(ControlSocketCommand::Stop),
        "show_admin_pin" => Some(ControlSocketCommand::ShowAdminPin),
        "rotate_pin" => Some(ControlSocketCommand::RotatePin),
        "show_player" => Some(ControlSocketCommand::ShowPlayer),
        "get_state" => Some(ControlSocketCommand::GetState),
        "list_audio_devices" => Some(ControlSocketCommand::ListAudioDevices),
        "set_audio_device" => rest
            .filter(|s| !s.is_empty())
            .map(|name| ControlSocketCommand::SetAudioDevice(name.to_string())),
        _ => None,
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn parses_known_commands() {
        assert_eq!(
            parse_command("play_pause"),
            Some(ControlSocketCommand::PlayPause)
        );
        assert_eq!(
            parse_command("rotate_pin"),
            Some(ControlSocketCommand::RotatePin)
        );
        assert_eq!(
            parse_command("show_player"),
            Some(ControlSocketCommand::ShowPlayer)
        );
        assert_eq!(
            parse_command("get_state"),
            Some(ControlSocketCommand::GetState)
        );
        assert_eq!(
            parse_command("list_audio_devices"),
            Some(ControlSocketCommand::ListAudioDevices)
        );
    }

    #[test]
    fn parses_set_audio_device_with_argument() {
        assert_eq!(
            parse_command("set_audio_device alsa/hw:1,0"),
            Some(ControlSocketCommand::SetAudioDevice(
                "alsa/hw:1,0".to_string()
            ))
        );
    }

    #[test]
    fn rejects_set_audio_device_without_argument() {
        assert_eq!(parse_command("set_audio_device"), None);
        assert_eq!(parse_command("set_audio_device   "), None);
    }

    #[test]
    fn rejects_unknown_commands() {
        assert_eq!(parse_command("banana"), None);
        assert_eq!(parse_command(""), None);
    }

    #[test]
    fn default_socket_path_uses_home_dir() {
        let path = resolve_socket_path(None);
        assert!(path.ends_with("rathole-control.sock"));
    }

    #[test]
    fn configured_socket_path_overrides_default() {
        let path = resolve_socket_path(Some("/tmp/custom.sock".to_string()));
        assert_eq!(path, std::path::PathBuf::from("/tmp/custom.sock"));
    }
}
