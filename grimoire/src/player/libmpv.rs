//! libmpv audio backend.
//!
//! deliberately simpler than `rodio.rs`'s supervised backend: no
//! watchdog/auto-restart-on-crash machinery yet. that's rodio's own
//! crash-recovery mechanism for a hand-rolled cpal pipeline; libmpv
//! itself is a far more battle-tested engine, and this is a first
//! working pass to prove the "experimental player" toggle out
//! end-to-end - add supervision later if libmpv audio turns out to
//! need it in practice.
//!
//! two threads, mirroring charnel's `video_window/libmpv_backend.rs`
//! split: one owns an `Mpv` handle and just applies `PlayerCommand`s to
//! mpv's own native playlist (`loadfile ... replace`/`append(-play)`,
//! `playlist-next`/`playlist-prev` for `Next`/`Previous` - no
//! hand-rolled queue/index bookkeeping); the other reads mpv's event
//! stream and translates property changes into `PlayerEvent`s.
//!
//! gated behind the `libmpv-playback` cargo feature.

use std::sync::{Arc, Mutex};
use std::thread;

use async_trait::async_trait;
use libmpv2::events::{Event as MpvEvent, PropertyData};
use libmpv2::{mpv_end_file_reason, Format, GetData, Mpv};
use tokio::sync::{broadcast, mpsc};

use crate::error::{ErrorDetail, GrimoireError, GrimoireResult};
use crate::player::control::{
    AudioDeviceInfo, PlayerCommand, PlayerEvent, PlayerSnapshot, PlayerState,
};
use crate::player::PlayerController;

const EVENT_CHANNEL_CAPACITY: usize = 256;
const COMMAND_CHANNEL_CAPACITY: usize = 32;

/// public handle. clone freely.
#[derive(Clone)]
pub struct LibmpvController {
    inner: Arc<Inner>,
}

struct Inner {
    cmd_tx: mpsc::Sender<PlayerCommand>,
    events: broadcast::Sender<PlayerEvent>,
    snapshot: Arc<Mutex<PlayerSnapshot>>,
    _event_thread: thread::JoinHandle<()>,
    _command_thread: thread::JoinHandle<()>,
    _snapshot_pump: tokio::task::JoinHandle<()>,
}

/// spawn a libmpv-backed player. must be called from inside a tokio
/// runtime (spawns the snapshot-pump task).
pub fn spawn_libmpv_player() -> GrimoireResult<LibmpvController> {
    // mpv_create() returns NULL (surfaces here as Error::Null) if
    // LC_NUMERIC isn't "C" - GTK's setlocale(LC_ALL, "") during window
    // init adopts the user's locale, which breaks mpv's internal
    // decimal-point parsing. reset it right before creating the
    // instance rather than relying on init order elsewhere.
    unsafe {
        libc::setlocale(libc::LC_NUMERIC, c"C".as_ptr());
    }
    let mpv = Mpv::new().map_err(|e| GrimoireError::ProcessingFailed {
        message: format!("failed to start libmpv: {e}"),
    })?;
    // audio-only - never render/select a video track even if a loaded
    // file happens to have one.
    let _ = mpv.set_property("vid", "no");

    // NOTE: create_client(Some(name)) is buggy in libmpv2 6.0.0 (drops
    // the CString before mpv_create_client reads its pointer) -> use
    // None, same workaround as the video backend (see
    // docs/libmpv-experimental-player-plan.md's spike findings).
    let events_client = mpv
        .create_client(None)
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to create libmpv event client: {e}"),
        })?;
    events_client.disable_deprecated_events().ok();
    for (name, format) in [
        ("time-pos", Format::Double),
        ("duration", Format::Double),
        ("pause", Format::Flag),
        ("playlist-pos", Format::Int64),
        ("path", Format::String),
        ("idle-active", Format::Flag),
    ] {
        let _ = events_client.observe_property(name, format, 0);
    }

    let (cmd_tx, cmd_rx) = mpsc::channel::<PlayerCommand>(COMMAND_CHANNEL_CAPACITY);
    let (events_tx, _) = broadcast::channel::<PlayerEvent>(EVENT_CHANNEL_CAPACITY);

    let events_for_commands = events_tx.clone();
    let command_thread = thread::Builder::new()
        .name("freqhole-libmpv-commands".into())
        .spawn(move || command_loop(mpv, cmd_rx, events_for_commands))
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to spawn libmpv command thread: {e}"),
        })?;

    let events_for_reader = events_tx.clone();
    let event_thread = thread::Builder::new()
        .name("freqhole-libmpv-events".into())
        .spawn(move || read_libmpv_events(events_client, events_for_reader))
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to spawn libmpv event thread: {e}"),
        })?;

    let snapshot = Arc::new(Mutex::new(PlayerSnapshot::default()));
    let snapshot_pump = tokio::spawn(pump_snapshot(events_tx.subscribe(), snapshot.clone()));

    Ok(LibmpvController {
        inner: Arc::new(Inner {
            cmd_tx,
            events: events_tx,
            snapshot,
            _event_thread: event_thread,
            _command_thread: command_thread,
            _snapshot_pump: snapshot_pump,
        }),
    })
}

/// blocks on the command channel (legal from a plain `std::thread`,
/// unlike `try_recv`/`recv` - `blocking_recv` is tokio's own escape
/// hatch for exactly this) and applies each command directly to mpv's
/// own playlist. exits (and asks mpv to quit) when the channel closes,
/// i.e. the controller was dropped.
fn command_loop(
    mpv: Mpv,
    mut cmd_rx: mpsc::Receiver<PlayerCommand>,
    events: broadcast::Sender<PlayerEvent>,
) {
    let mut queue: Vec<String> = Vec::new();
    while let Some(cmd) = cmd_rx.blocking_recv() {
        // logged (not just surfaced as a toast) - the audio thread has no
        // other visibility into which specific command failed, and
        // `PlayerCommand`'s own `Debug` derive already elides nothing
        // sensitive (paths, not credentials).
        let cmd_debug = format!("{cmd:?}");
        if let Err(message) = apply_command(&mpv, &mut queue, cmd, &events) {
            tracing::warn!(command = %cmd_debug, error = %message, "[player] libmpv command failed");
            emit(
                &events,
                PlayerEvent::Error {
                    detail: ErrorDetail::new(
                        "libmpv_command_failed",
                        "Libmpv Command Failed",
                        message,
                    ),
                },
            );
        }
    }
    let _ = mpv.command("quit", &[]);
}

fn apply_command(
    mpv: &Mpv,
    queue: &mut Vec<String>,
    cmd: PlayerCommand,
    events: &broadcast::Sender<PlayerEvent>,
) -> Result<(), String> {
    match cmd {
        PlayerCommand::Load {
            paths,
            start_ms,
            start_paused,
        } => {
            *queue = paths;
            let mut iter = queue.iter();
            if let Some(first) = iter.next() {
                let args = loadfile_args(first, start_ms, start_paused);
                let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
                mpv.command("loadfile", &arg_refs)
                    .map_err(|e| mpv_err("loadfile (replace)", e))?;
            }
            for path in iter {
                mpv.command("loadfile", &[path.as_str(), "append"])
                    .map_err(|e| mpv_err("loadfile (append)", e))?;
            }
            // mpv starts playing immediately on a successful `loadfile
            // ... replace` (no `--pause`) - emit `Playing` synchronously
            // rather than waiting on the event thread's `pause`
            // property-change notification, which mpv only sends once
            // playback actually reaches that point (a real, observed
            // delay/possible-miss - see the same fix below for `Play`).
            // the event thread's own observation still corrects this if
            // mpv's actual state ends up different (e.g. load failure).
            if !queue.is_empty() {
                emit(
                    events,
                    PlayerEvent::State {
                        state: if start_paused {
                            PlayerState::Paused
                        } else {
                            PlayerState::Playing
                        },
                    },
                );
            }
            Ok(())
        }
        PlayerCommand::Enqueue { paths } => {
            let was_empty = queue.is_empty();
            for (i, path) in paths.iter().enumerate() {
                let flag = if was_empty && i == 0 {
                    "append-play"
                } else {
                    "append"
                };
                mpv.command("loadfile", &[path.as_str(), flag])
                    .map_err(|e| mpv_err("loadfile (enqueue)", e))?;
            }
            queue.extend(paths);
            if was_empty {
                emit(
                    events,
                    PlayerEvent::State {
                        state: PlayerState::Playing,
                    },
                );
            }
            Ok(())
        }
        PlayerCommand::Play => {
            mpv.set_property("pause", false)
                .map_err(|e| mpv_err("set pause=false", e))?;
            // see the `Load` comment above - the playerbar needs this
            // synchronously, not only once the event thread's `pause`
            // property-change notification arrives.
            emit(
                events,
                PlayerEvent::State {
                    state: PlayerState::Playing,
                },
            );
            Ok(())
        }
        PlayerCommand::Pause => {
            mpv.set_property("pause", true)
                .map_err(|e| mpv_err("set pause=true", e))?;
            emit(
                events,
                PlayerEvent::State {
                    state: PlayerState::Paused,
                },
            );
            Ok(())
        }
        PlayerCommand::Stop => {
            queue.clear();
            mpv.command("stop", &[]).map_err(|e| mpv_err("stop", e))
        }
        PlayerCommand::Next => mpv
            .command("playlist-next", &["force"])
            .map_err(|e| mpv_err("playlist-next", e)),
        PlayerCommand::Previous => mpv
            .command("playlist-prev", &["force"])
            .map_err(|e| mpv_err("playlist-prev", e)),
        PlayerCommand::Seek { ms } => mpv
            .command("seek", &[&(ms as f64 / 1000.0).to_string(), "absolute"])
            .map_err(|e| mpv_err("seek", e)),
        PlayerCommand::SetVolume { v } => mpv
            .set_property("volume", (v * 100.0) as f64)
            .map_err(|e| mpv_err("set volume", e)),
        // real state/duration/position come from the event thread's
        // property-change stream, not a one-shot query - nothing to do
        // synchronously here yet (matches rodio's own `Status` handling
        // being folded into its periodic progress emission).
        PlayerCommand::Status => Ok(()),
        PlayerCommand::ListOutputDevices => {
            emit(
                events,
                PlayerEvent::OutputDevices {
                    devices: list_audio_devices(mpv),
                },
            );
            Ok(())
        }
        // hot-swappable at runtime - mpv reinitializes its audio output
        // against the new device without needing a reload, unlike rodio's
        // manual stream-rebuild dance.
        PlayerCommand::SetOutputDevice { name } => mpv
            .set_property("audio-device", name.as_str())
            .map_err(|e| mpv_err("set audio-device", e)),
    }
}

/// list audio output devices mpv currently knows about (`audio-device-list`
/// property, `[{name, description}, ...]`) - reports the same system-level
/// device set regardless of which `Mpv` instance asks, so charnel's video
/// window backend (`video_window/libmpv_backend.rs`) calls this too rather
/// than duplicating the MPV_FORMAT_NODE parsing - one picker, one device
/// list, for both audio and video.
pub fn list_audio_devices(mpv: &Mpv) -> Vec<AudioDeviceInfo> {
    match mpv.get_property::<DeviceListNode>("audio-device-list") {
        Ok(node) => parse_device_list_node(&node.0),
        Err(e) => {
            tracing::warn!(target: "player", error = %e, "[libmpv] failed to query audio-device-list");
            Vec::new()
        }
    }
}

/// owns a raw `mpv_node` long enough to parse it, then frees mpv's nested
/// allocations (strings, the node list itself) via `mpv_free_node_contents`.
/// required whenever mpv writes a node into caller-owned memory, as opposed
/// to a node the caller built itself, which must NOT be freed this way -
/// see the client API's own doc comment on `mpv_node`.
struct DeviceListNode(libmpv2_sys::mpv_node);

impl Drop for DeviceListNode {
    fn drop(&mut self) {
        unsafe { libmpv2_sys::mpv_free_node_contents(&mut self.0) };
    }
}

// libmpv2's safe `GetData` trait (used by `Mpv::get_property`) has no
// built-in impl for `Format::Node` - only String/Flag/Int64/Double. `name`/
// `audio-device-list` are exactly the kind of array-of-maps property that
// needs MPV_FORMAT_NODE, so we implement `GetData` ourselves against
// libmpv2-sys's raw bindgen'd `mpv_node` struct rather than waiting on
// upstream to add a typed getter.
unsafe impl GetData for DeviceListNode {
    fn get_from_c_void<T, F: FnMut(*mut std::os::raw::c_void) -> libmpv2::Result<T>>(
        mut fun: F,
    ) -> libmpv2::Result<Self> {
        let mut node = std::mem::MaybeUninit::<libmpv2_sys::mpv_node>::uninit();
        fun(node.as_mut_ptr() as *mut _)?;
        Ok(DeviceListNode(unsafe { node.assume_init() }))
    }

    fn get_format() -> Format {
        Format::Node
    }
}

fn parse_device_list_node(node: &libmpv2_sys::mpv_node) -> Vec<AudioDeviceInfo> {
    if node.format != libmpv2_sys::mpv_format_MPV_FORMAT_NODE_ARRAY {
        return Vec::new();
    }
    // SAFETY: format == NODE_ARRAY guarantees `u.list` is the active union
    // member (see mpv_node's own doc comment on which member each format
    // value makes valid to read).
    let list = unsafe { &*node.u.list };
    if list.num <= 0 || list.values.is_null() {
        return Vec::new();
    }
    let entries = unsafe { std::slice::from_raw_parts(list.values, list.num as usize) };
    entries.iter().filter_map(parse_device_entry).collect()
}

fn parse_device_entry(entry: &libmpv2_sys::mpv_node) -> Option<AudioDeviceInfo> {
    if entry.format != libmpv2_sys::mpv_format_MPV_FORMAT_NODE_MAP {
        return None;
    }
    // SAFETY: format == NODE_MAP guarantees `u.list` is the active member.
    let map = unsafe { &*entry.u.list };
    if map.num <= 0 || map.values.is_null() || map.keys.is_null() {
        return None;
    }
    let mut name = None;
    let mut description = None;
    for i in 0..map.num as usize {
        // SAFETY: i < map.num, and NODE_MAP guarantees both keys[i] and
        // values[i] are valid for reads (see mpv_node_list's doc comment).
        let key = unsafe { std::ffi::CStr::from_ptr(*map.keys.add(i)) }.to_string_lossy();
        let value = unsafe { &*map.values.add(i) };
        if value.format != libmpv2_sys::mpv_format_MPV_FORMAT_STRING {
            continue;
        }
        // SAFETY: format == STRING guarantees `u.string` is the active member.
        let s = unsafe { std::ffi::CStr::from_ptr(value.u.string) }
            .to_string_lossy()
            .into_owned();
        match key.as_ref() {
            "name" => name = Some(s),
            "description" => description = Some(s),
            _ => {}
        }
    }
    let name = name?;
    let description = description.unwrap_or_else(|| name.clone());
    Some(AudioDeviceInfo { name, description })
}

/// build the `loadfile` command arguments for a `replace` load, folding
/// an optional resume position and/or "start paused" into the same
/// atomic mpv command instead of separate follow-up `Seek`/`Pause`
/// commands, either of which can race mpv still opening the file -
/// confirmed 2026-09-29: a fast Load-then-Pause-then-Seek sequence
/// reliably left the file unable to seek until playback had actually
/// started at least once. mirrors charnel's `video_window/
/// libmpv_backend.rs`'s own `loadfile_args` (can't share it directly -
/// charnel depends on grimoire, not the other way around): mpv's real
/// signature is `<url> [<flags> [<index> [<options>]]]` - `<index>` sits
/// *before* `<options>`, so any options need the `-1` placeholder in the
/// index slot, or they get mis-parsed as the index itself. multiple
/// options are a single comma-joined string, same as mpv's per-file
/// playlist option syntax.
fn loadfile_args(path: &str, start_ms: Option<u64>, start_paused: bool) -> Vec<String> {
    let mut args = vec![path.to_string(), "replace".to_string()];
    let mut opts = Vec::new();
    if let Some(ms) = start_ms.filter(|ms| *ms > 0) {
        opts.push(format!("start={}", ms as f64 / 1000.0));
    }
    if start_paused {
        opts.push("pause=yes".to_string());
    }
    if !opts.is_empty() {
        args.push("-1".to_string());
        args.push(opts.join(","));
    }
    args
}

/// includes which mpv operation failed - `libmpv2::Error`'s own `Display`
/// (e.g. `Raw(-12)`) gives no clue on its own which of several `command()`/
/// `set_property()` calls in `apply_command` actually failed.
fn mpv_err(operation: &str, e: libmpv2::Error) -> String {
    format!("libmpv {operation} failed: {e}")
}

fn read_libmpv_events(events_client: Mpv, events: broadcast::Sender<PlayerEvent>) {
    // mpv_observe_property delivers one notification carrying the
    // CURRENT value immediately upon starting observation, for every
    // property - a fresh Mpv (idle, nothing ever loaded) reports
    // pause=false and idle-active=true right away, which the handlers
    // below would otherwise blindly read as "now playing" / "queue
    // ended", firing before the first real Load ever happens. don't
    // trust either property until a real file has actually loaded (a
    // genuine `playlist-pos`/`path` change) - otherwise this spurious
    // pair causes phantom playback and an auto-advance to the next
    // queue item on every app boot.
    let mut ever_loaded = false;
    loop {
        match events_client.wait_event(1.0) {
            Some(Ok(MpvEvent::PropertyChange {
                name: "time-pos",
                change: PropertyData::Double(position),
                ..
            })) => {
                let total = events_client.get_property::<f64>("duration").unwrap_or(0.0);
                emit(
                    &events,
                    PlayerEvent::Progress {
                        ms: (position.max(0.0) * 1000.0) as u64,
                        total_ms: (total.max(0.0) * 1000.0) as u64,
                    },
                );
            }
            Some(Ok(MpvEvent::PropertyChange {
                name: "pause",
                change: PropertyData::Flag(paused),
                ..
            })) => {
                if !ever_loaded {
                    continue;
                }
                let state = if paused {
                    PlayerState::Paused
                } else {
                    PlayerState::Playing
                };
                emit(&events, PlayerEvent::State { state });
            }
            Some(Ok(MpvEvent::PropertyChange {
                name: "playlist-pos" | "path",
                ..
            })) => {
                let index = events_client
                    .get_property::<i64>("playlist-pos")
                    .unwrap_or(-1);
                let path = events_client
                    .get_property::<String>("path")
                    .unwrap_or_default();
                if index >= 0 && !path.is_empty() {
                    ever_loaded = true;
                    emit(
                        &events,
                        PlayerEvent::TrackChanged {
                            index: index as u32,
                            path,
                        },
                    );
                }
            }
            Some(Ok(MpvEvent::PropertyChange {
                name: "idle-active",
                change: PropertyData::Flag(true),
                ..
            })) => {
                if !ever_loaded {
                    continue;
                }
                emit(&events, PlayerEvent::Ended);
            }
            Some(Ok(MpvEvent::EndFile(reason))) if reason == mpv_end_file_reason::Error => {
                emit(
                    &events,
                    PlayerEvent::Error {
                        detail: ErrorDetail::new(
                            "playback_failed",
                            "Playback Failed",
                            "libmpv failed to play this file",
                        ),
                    },
                );
            }
            Some(Ok(MpvEvent::Shutdown)) => return,
            Some(Err(e)) => {
                tracing::warn!(error = ?e, "[player] libmpv event error");
            }
            Some(Ok(_)) | None => {}
        }
    }
}

fn emit(events: &broadcast::Sender<PlayerEvent>, event: PlayerEvent) {
    let _ = events.send(event);
}

async fn pump_snapshot(
    mut rx: broadcast::Receiver<PlayerEvent>,
    snapshot: Arc<Mutex<PlayerSnapshot>>,
) {
    loop {
        match rx.recv().await {
            Ok(ev) => {
                if let Ok(mut snap) = snapshot.lock() {
                    snap.apply(&ev);
                }
            }
            Err(broadcast::error::RecvError::Closed) => return,
            Err(broadcast::error::RecvError::Lagged(_)) => continue,
        }
    }
}

#[async_trait]
impl PlayerController for LibmpvController {
    async fn send(&self, cmd: PlayerCommand) -> GrimoireResult<()> {
        self.inner
            .cmd_tx
            .send(cmd)
            .await
            .map_err(|_| GrimoireError::ProcessingFailed {
                message: "libmpv command channel closed".to_string(),
            })
    }

    fn subscribe(&self) -> broadcast::Receiver<PlayerEvent> {
        self.inner.events.subscribe()
    }

    fn snapshot(&self) -> PlayerSnapshot {
        self.inner
            .snapshot
            .lock()
            .map(|s| s.clone())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod device_list_parsing_tests {
    use super::*;
    use std::ffi::CString;

    fn string_node(s: &CString) -> libmpv2_sys::mpv_node {
        libmpv2_sys::mpv_node {
            u: libmpv2_sys::mpv_node__bindgen_ty_1 {
                string: s.as_ptr() as *mut _,
            },
            format: libmpv2_sys::mpv_format_MPV_FORMAT_STRING,
        }
    }

    fn map_node(
        values: &mut [libmpv2_sys::mpv_node],
        keys: &mut [*mut std::os::raw::c_char],
    ) -> libmpv2_sys::mpv_node_list {
        libmpv2_sys::mpv_node_list {
            num: values.len() as i32,
            values: values.as_mut_ptr(),
            keys: keys.as_mut_ptr(),
        }
    }

    #[test]
    fn parses_two_devices_from_node_array() {
        let name1 = CString::new("auto").unwrap();
        let desc1 = CString::new("Autoselect device").unwrap();
        let name2 = CString::new("pipewire/foo").unwrap();
        let desc2 = CString::new("Foo Speakers").unwrap();
        let key_name = CString::new("name").unwrap();
        let key_desc = CString::new("description").unwrap();

        let mut entry1_values = [string_node(&name1), string_node(&desc1)];
        let mut entry1_keys = [key_name.as_ptr() as *mut _, key_desc.as_ptr() as *mut _];
        let entry1_list = map_node(&mut entry1_values, &mut entry1_keys);
        let entry1 = libmpv2_sys::mpv_node {
            u: libmpv2_sys::mpv_node__bindgen_ty_1 {
                list: &entry1_list as *const _ as *mut _,
            },
            format: libmpv2_sys::mpv_format_MPV_FORMAT_NODE_MAP,
        };

        let mut entry2_values = [string_node(&name2), string_node(&desc2)];
        let mut entry2_keys = [key_name.as_ptr() as *mut _, key_desc.as_ptr() as *mut _];
        let entry2_list = map_node(&mut entry2_values, &mut entry2_keys);
        let entry2 = libmpv2_sys::mpv_node {
            u: libmpv2_sys::mpv_node__bindgen_ty_1 {
                list: &entry2_list as *const _ as *mut _,
            },
            format: libmpv2_sys::mpv_format_MPV_FORMAT_NODE_MAP,
        };

        let mut array_values = [entry1, entry2];
        let array_list = libmpv2_sys::mpv_node_list {
            num: 2,
            values: array_values.as_mut_ptr(),
            keys: std::ptr::null_mut(),
        };
        let array_node = libmpv2_sys::mpv_node {
            u: libmpv2_sys::mpv_node__bindgen_ty_1 {
                list: &array_list as *const _ as *mut _,
            },
            format: libmpv2_sys::mpv_format_MPV_FORMAT_NODE_ARRAY,
        };

        let devices = parse_device_list_node(&array_node);
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].name, "auto");
        assert_eq!(devices[0].description, "Autoselect device");
        assert_eq!(devices[1].name, "pipewire/foo");
        assert_eq!(devices[1].description, "Foo Speakers");
    }

    #[test]
    fn missing_description_falls_back_to_name() {
        let name = CString::new("auto").unwrap();
        let key_name = CString::new("name").unwrap();

        let mut entry_values = [string_node(&name)];
        let mut entry_keys = [key_name.as_ptr() as *mut _];
        let entry_list = map_node(&mut entry_values, &mut entry_keys);
        let entry = libmpv2_sys::mpv_node {
            u: libmpv2_sys::mpv_node__bindgen_ty_1 {
                list: &entry_list as *const _ as *mut _,
            },
            format: libmpv2_sys::mpv_format_MPV_FORMAT_NODE_MAP,
        };

        let mut array_values = [entry];
        let array_list = libmpv2_sys::mpv_node_list {
            num: 1,
            values: array_values.as_mut_ptr(),
            keys: std::ptr::null_mut(),
        };
        let array_node = libmpv2_sys::mpv_node {
            u: libmpv2_sys::mpv_node__bindgen_ty_1 {
                list: &array_list as *const _ as *mut _,
            },
            format: libmpv2_sys::mpv_format_MPV_FORMAT_NODE_ARRAY,
        };

        let devices = parse_device_list_node(&array_node);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].name, "auto");
        assert_eq!(devices[0].description, "auto");
    }

    #[test]
    fn wrong_top_level_format_returns_empty() {
        let node = libmpv2_sys::mpv_node {
            u: libmpv2_sys::mpv_node__bindgen_ty_1 { int64: 0 },
            format: libmpv2_sys::mpv_format_MPV_FORMAT_INT64,
        };
        assert!(parse_device_list_node(&node).is_empty());
    }

    #[test]
    fn empty_array_returns_empty() {
        let array_list = libmpv2_sys::mpv_node_list {
            num: 0,
            values: std::ptr::null_mut(),
            keys: std::ptr::null_mut(),
        };
        let array_node = libmpv2_sys::mpv_node {
            u: libmpv2_sys::mpv_node__bindgen_ty_1 {
                list: &array_list as *const _ as *mut _,
            },
            format: libmpv2_sys::mpv_format_MPV_FORMAT_NODE_ARRAY,
        };
        assert!(parse_device_list_node(&array_node).is_empty());
    }
}
