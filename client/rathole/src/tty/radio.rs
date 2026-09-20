//! rathole's `--player`/cenotaph radio client.
//!
//! connects to a broadcaster over `freqhole-radio/1` (grimoire's own
//! `radio::{messages,protocol}` types - the same wire format the
//! browser/wasm and charnel radio clients use, see
//! `client/charnel/src-tauri/src/radio_commands.rs`, which this
//! module's connect/tune/hello handshake mirrors closely), and feeds
//! the raw fMP4 chunk stream straight into a DEDICATED mpv process's
//! own stdin, as one continuous byte stream for the whole session.
//!
//! mpv (not rodio) drives radio playback: rodio's `PlayerCommand::Load`
//! only ever opens a real `std::fs::File` (needs `Read + Seek`, since
//! rodio/symphonia's `Decoder::new` requires `Seek`), and a live stream
//! isn't seekable. mpv already handles exactly this (it's built for
//! HLS/live streams).
//!
//! this is a DEDICATED mpv process (`RadioMpv`, spawned fresh per
//! session), NOT the shared `app.video_player` used for on-demand queue
//! playback - reading a live radio feed needs sole ownership of the
//! child's stdin for the whole session, which isn't compatible with a
//! process shared with unrelated queue playback.
//!
//! an earlier version of this module used a fresh named pipe per track
//! (torn down/recreated on every `is_init` chunk, `loadfile`d into the
//! shared mpv backend over its json ipc socket) on the theory that mpv
//! has "no clean way" to reset mid-stream. that turned out to be both
//! UNRELIABLE (mpv would frequently accept the `loadfile` ipc command
//! but never actually start demuxing - confirmed via direct
//! reproduction, see docs/radio-mpv-fifo-stall-investigation.md) and
//! UNNECESSARY (a validated test confirmed mpv tolerates a second,
//! independent `ftyp+moov` arriving mid-stream on a single stdin pipe
//! without hanging or erroring - it just keeps playing). so a fresh
//! `is_init` chunk now just marks "this is where a new track begins"
//! for the wire protocol/ui's own bookkeeping (`AppAction::
//! RadioStatusUpdate`, driven by `Meta` control messages) - the actual
//! media bytes just keep flowing into the same mpv stdin handle,
//! uninterrupted.

use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};

use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc;

use grimoire::federation::p2p_client::{get_endpoint_arc, parse_peer_address};
use grimoire::radio::messages::{ControlMessage, TuneMessage};
use grimoire::radio::protocol::{
    read_chunk, read_control_message, write_control_message, RADIO_ALPN,
};

use crate::ratcore::app::{App, AppAction, RadioPlaybackState};

/// bumped on every `start`/`stop` - lets a superseded session's task
/// recognize it's stale (another tune or an explicit stop happened)
/// and stop touching mpv/fifos, without needing a cross-task
/// cancellation channel. mirrors the `playGeneration`/`adapterGeneration`
/// staleness-guard pattern already used on the spume side for the same
/// "an old async loop must not keep acting once it's been superseded"
/// problem (see radioQueueAdapter.ts/playbackEngine.ts).
static GENERATION: AtomicU64 = AtomicU64::new(0);

fn generation_is_current(generation: u64) -> bool {
    GENERATION.load(Ordering::SeqCst) == generation
}

/// start (or retune) a radio session - any previous session is
/// superseded immediately (its next chunk/control-message check will
/// fail and it tears itself down on its own). unlike on-demand queue
/// video, there's no upfront "no mpv backend in this shell" check here
/// - `RadioMpv::spawn` is attempted lazily on the first chunk and any
/// failure (mpv missing, failed to spawn, etc.) surfaces as a normal
/// `AppAction::RadioEnded` error through the same path as any other
/// session failure.
pub fn start(
    app: &mut App,
    peer_addr: String,
    station_id: Option<String>,
    tx: mpsc::UnboundedSender<AppAction>,
) {
    // mutually exclusive with regular queue playback, same reasoning
    // as switching between audio/video queue entries - see
    // `tty::queue::play_index`'s module doc.
    super::queue::stop_for_radio(app);

    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    app.state.ephemeral.radio = RadioPlaybackState {
        active: true,
        station_id: station_id.clone(),
        station_name: None,
        track_title: None,
        track_artist: None,
        last_error: None,
    };

    tokio::task::spawn_local(async move {
        let result = run_session(generation, peer_addr, station_id, tx.clone()).await;
        if generation_is_current(generation) {
            let _ = tx.send(AppAction::RadioEnded {
                error: result.err(),
            });
        }
    });
}

/// fetches every radio station a remote peer knows about, over the same
/// p2p transport `start` uses to actually tune (`api_request`/
/// `FREQHOLE_ALPN` - see grimoire's `p2p_client.rs`) hitting the peer's
/// public, unauthenticated `GET /api/radio/stations` discovery route
/// directly - the exact one spume/charnel's own radio browse views poll.
/// read-only: doesn't touch `app.state` or start a session.
pub async fn scan_remote_stations(peer_addr: &str) -> crate::ratcore::app::DispatchResponse {
    use crate::ratcore::app::DispatchResponse;
    match fetch_stations_raw(peer_addr).await {
        Ok(stations) => DispatchResponse {
            success: true,
            message: format!("found {} radio station(s) on {peer_addr}", stations.len()),
            data: Some(serde_json::Value::Array(stations)),
        },
        Err(e) => DispatchResponse {
            success: false,
            message: e,
            data: None,
        },
    }
}

/// scans every known remote's public radio stations concurrently and
/// merges them into one flat row list, each row stamped with
/// `remote_name`/`peer_addr` so a selected row carries everything
/// `start` needs to tune in directly - backs `/radio` (bare)/`/radio
/// list`'s result-panel listing. remotes with no `peer_addr` (http-only
/// entries - rathole can only dial p2p ones) or that fail to respond are
/// silently skipped rather than failing the whole scan; the summary
/// message reports how many of each.
pub async fn scan_all_remote_stations(
    remotes: &[crate::ratcore::app::RemoteEntry],
) -> crate::ratcore::app::DispatchResponse {
    use crate::ratcore::app::DispatchResponse;

    let dialable: Vec<(&str, &str)> = remotes
        .iter()
        .filter_map(|r| r.peer_addr.as_deref().map(|p| (r.name.as_str(), p)))
        .collect();

    if dialable.is_empty() {
        return DispatchResponse {
            success: true,
            message: "no known remotes with a p2p address to scan - use /remote to add one"
                .to_string(),
            data: Some(serde_json::Value::Array(vec![])),
        };
    }

    let fetches = dialable.into_iter().map(|(name, peer_addr)| {
        let name = name.to_string();
        let peer_addr = peer_addr.to_string();
        async move {
            let result = fetch_stations_raw(&peer_addr).await;
            (name, peer_addr, result)
        }
    });
    let results = futures::future::join_all(fetches).await;

    let mut rows: Vec<serde_json::Value> = Vec::new();
    let mut failed = 0usize;
    for (remote_name, peer_addr, result) in results {
        match result {
            Ok(stations) => {
                for mut station in stations {
                    if let Some(obj) = station.as_object_mut() {
                        obj.insert(
                            "remote_name".to_string(),
                            serde_json::Value::String(remote_name.clone()),
                        );
                        obj.insert(
                            "peer_addr".to_string(),
                            serde_json::Value::String(peer_addr.clone()),
                        );
                    }
                    rows.push(station);
                }
            }
            Err(_) => failed += 1,
        }
    }

    let ok_count = remotes.len().saturating_sub(failed);
    DispatchResponse {
        success: true,
        message: format!(
            "found {} radio station(s) across {ok_count} remote(s){}",
            rows.len(),
            if failed > 0 {
                format!(" ({failed} unreachable)")
            } else {
                String::new()
            }
        ),
        data: Some(serde_json::Value::Array(rows)),
    }
}

/// merges a local `radio_stations_list`-shaped [`DispatchResponse`]
/// (rows from `grimoire::radio::stations::repository::list_stations`,
/// keyed by `id`) with a [`scan_all_remote_stations`]-shaped one (rows
/// already stamped with `station_id`/`remote_name`/`peer_addr`) into
/// one flat, uniformly-shaped row list for `/radio` (bare)/`/radio
/// list` - see that function's doc comment for why bare/list needs to
/// show both (rathole's own db is frequently a real, populated station
/// list too, not just an admin-empty stub). local rows get
/// `station_id` copied from `id`, `remote_name: "this device"`, and -
/// when p2p is up - our own node id as `peer_addr`, so a local row can
/// be tuned into via the same `__radio_tune_in__` self-dial path as a
/// remote one; if p2p isn't ready yet the row still shows, just without
/// a working "tune in" until it is.
pub fn merge_local_and_remote_stations(
    local: crate::ratcore::app::DispatchResponse,
    remote: crate::ratcore::app::DispatchResponse,
) -> crate::ratcore::app::DispatchResponse {
    use crate::ratcore::app::DispatchResponse;

    let own_node_id = grimoire::federation::p2p_client::get_node_id().ok();

    let mut rows: Vec<serde_json::Value> = Vec::new();
    if let Some(serde_json::Value::Array(local_rows)) = local.data {
        for mut station in local_rows {
            if let Some(obj) = station.as_object_mut() {
                if let Some(id) = obj.get("id").cloned() {
                    obj.insert("station_id".to_string(), id);
                }
                obj.insert(
                    "remote_name".to_string(),
                    serde_json::Value::String("this device".to_string()),
                );
                if let Some(node_id) = &own_node_id {
                    obj.insert(
                        "peer_addr".to_string(),
                        serde_json::Value::String(node_id.clone()),
                    );
                }
            }
            rows.push(station);
        }
    }
    let local_count = rows.len();
    let mut remote_count = 0usize;
    if let Some(serde_json::Value::Array(remote_rows)) = remote.data {
        remote_count = remote_rows.len();
        rows.extend(remote_rows);
    }

    let mut message = format!("{local_count} local, {remote_count} remote radio station(s)");
    if remote_count == 0 && !remote.message.is_empty() {
        message.push_str(&format!(" ({})", remote.message));
    }

    DispatchResponse {
        success: true,
        message,
        data: Some(serde_json::Value::Array(rows)),
    }
}

/// shared `GET /api/radio/stations` fetch + response unwrap for
/// [`scan_remote_stations`]/[`scan_all_remote_stations`] - returns just
/// the `stations` array, or an error string on any failure (transport,
/// non-200, or unparseable body).
async fn fetch_stations_raw(peer_addr: &str) -> Result<Vec<serde_json::Value>, String> {
    let resp = grimoire::federation::p2p_client::api_request(
        peer_addr,
        "GET",
        "/api/radio/stations",
        None,
    )
    .await
    .map_err(|e| e.to_string())?;
    if resp.status != 200 {
        return Err(format!(
            "peer returned status {}: {}",
            resp.status, resp.body
        ));
    }
    let json: serde_json::Value =
        serde_json::from_str(&resp.body).map_err(|e| format!("unreadable response: {e}"))?;
    let stations = json
        .get("data")
        .and_then(|d| d.get("stations"))
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(stations)
}

/// stop the active radio session (if any). bumps the generation so the
/// running task's next check fails and it tears itself down on its own
/// (closing its iroh connection + dedicated mpv process) - reactive
/// rather than instant, but in practice the loop notices on its next
/// chunk/control message, which for an actively-streaming station is
/// typically well under a second away.
pub fn stop(app: &mut App) {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    app.state.ephemeral.radio = RadioPlaybackState::default();
}

async fn run_session(
    generation: u64,
    peer_addr: String,
    station_id: Option<String>,
    tx: mpsc::UnboundedSender<AppAction>,
) -> Result<(), String> {
    let endpoint = get_endpoint_arc().map_err(|e| e.to_string())?;
    let addr = parse_peer_address(&peer_addr).map_err(|e| e.to_string())?;
    let conn = endpoint
        .connect(addr, RADIO_ALPN)
        .await
        .map_err(|e| format!("connect: {e}"))?;

    let (mut ctrl_send, mut ctrl_recv) = conn
        .open_bi()
        .await
        .map_err(|e| format!("open control stream: {e}"))?;
    write_control_message(
        &mut ctrl_send,
        &ControlMessage::Tune(TuneMessage {
            station_id: station_id.clone(),
        }),
    )
    .await
    .map_err(|e| format!("send tune: {e}"))?;

    let hello = match read_control_message(&mut ctrl_recv)
        .await
        .map_err(|e| format!("read hello: {e}"))?
    {
        Some(ControlMessage::Hello(h)) => h,
        Some(_) => return Err("radio: expected Hello first".to_string()),
        None => return Err("radio: connection closed before Hello".to_string()),
    };
    if hello.broadcaster_timeline_only {
        return Err(
            "this station has no live audio stream (timeline-only mode isn't supported yet)"
                .to_string(),
        );
    }
    if !generation_is_current(generation) {
        return Ok(());
    }
    let _ = tx.send(AppAction::RadioStatusUpdate {
        station_name: Some(station_id.clone().unwrap_or_else(|| "default".to_string())),
        track_title: Some(hello.now_playing.title.clone()),
        track_artist: hello.now_playing.artist.clone(),
    });

    let mut audio_recv = conn
        .accept_uni()
        .await
        .map_err(|e| format!("accept audio stream: {e}"))?;

    // spawned lazily on the first chunk (not upfront) so a station that
    // never sends any audio (shouldn't happen, but matches the old
    // per-track-fifo design's laziness) doesn't pop a window/spawn mpv
    // for nothing.
    let mut mpv: Option<RadioMpv> = None;
    // discard bytes until the next init chunk - mirrors the old
    // per-track-fifo design's "close the fifo, wait for next init" on a
    // Lag/Skip control message, just without anything to actually tear
    // down anymore (see this module's doc comment).
    let mut discard_until_init = false;

    loop {
        if !generation_is_current(generation) {
            return Ok(());
        }
        tokio::select! {
            chunk = read_chunk(&mut audio_recv) => {
                let Some(chunk) = chunk.map_err(|e| e.to_string())? else {
                    return Ok(()); // clean eof - broadcaster closed the audio stream.
                };
                if chunk.is_init {
                    discard_until_init = false;
                }
                if discard_until_init {
                    continue;
                }
                if mpv.is_none() {
                    mpv = Some(RadioMpv::spawn().await?);
                }
                if let Some(mpv) = mpv.as_mut() {
                    mpv.write(&chunk.bytes).await?;
                }
            }
            ctrl = read_control_message(&mut ctrl_recv) => {
                match ctrl.map_err(|e| e.to_string())? {
                    Some(ControlMessage::Meta(meta)) => {
                        let _ = tx.send(AppAction::RadioStatusUpdate {
                            station_name: None,
                            track_title: Some(meta.now_playing.title),
                            track_artist: meta.now_playing.artist,
                        });
                    }
                    // both mean "discard until the next init chunk" -
                    // see `discard_until_init`'s doc comment above.
                    Some(ControlMessage::Lag(_)) | Some(ControlMessage::Skip(_)) => {
                        discard_until_init = true;
                    }
                    Some(ControlMessage::Goodbye(g)) => {
                        return Err(format!("station closed the session: {}", g.reason));
                    }
                    Some(_) => {}
                    None => return Ok(()), // control stream closed cleanly.
                }
            }
        }
    }
}

/// dedicated mpv process for one radio session, fed via its own stdin
/// as one continuous byte stream - NOT the shared `app.video_player`
/// used for on-demand queue playback (see this module's doc comment for
/// why). owned by `run_session`'s local loop; dropping it (session
/// ends, for any reason) kills the process via `kill_on_drop`.
struct RadioMpv {
    // holds the process alive + kills it on drop; its own `stdin` field
    // is `None` after `take()` below, but that doesn't affect killing.
    _child: Child,
    stdin: ChildStdin,
}

impl RadioMpv {
    async fn spawn() -> Result<Self, String> {
        let mut child = Command::new("mpv")
            .arg("-") // read the media stream from stdin.
            .arg("--idle=yes")
            .arg("--force-window=no")
            .arg(format!(
                "--vo={}",
                super::video_player::default_video_output()
            ))
            .arg("--no-terminal")
            .arg("--msg-level=all=warn")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("failed to spawn mpv: {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "mpv stdin unavailable".to_string())?;
        if let Some(stdout) = child.stdout.take() {
            tokio::task::spawn_local(super::video_player::log_mpv_output(stdout, "stdout"));
        }
        if let Some(stderr) = child.stderr.take() {
            tokio::task::spawn_local(super::video_player::log_mpv_output(stderr, "stderr"));
        }

        Ok(Self {
            _child: child,
            stdin,
        })
    }

    async fn write(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.stdin
            .write_all(bytes)
            .await
            .map_err(|e| format!("write to mpv stdin: {e}"))
    }
}
