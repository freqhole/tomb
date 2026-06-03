//! rodio audio backend.
//!
//! takes [`PlayerCommand`]s on an mpsc receiver, drives a rodio
//! [`Player`] on a dedicated audio thread, and emits [`PlayerEvent`]s
//! to a broadcast channel.
//!
//! design notes:
//!
//! - rodio + cpal are blocking apis with strong thread-affinity for
//!   the [`MixerDeviceSink`] (it owns the cpal device handle and is
//!   not `Send`). we keep it on a dedicated `std::thread` and bridge
//!   to tokio via channels.
//! - **no `unwrap` / `expect` / `panic!`** in the audio loop. every
//!   error path emits a structured [`PlayerEvent::Error`] and keeps
//!   the loop alive. only an unexpected return from [`audio_loop`]
//!   triggers the supervisor's restart logic.
//! - the loop polls the command channel with a short timeout so it
//!   can also emit ~4 hz progress events while playing.
//! - on linux we set `cpal::BufferSize::Fixed(2048)` explicitly.
//!   rodio's default already aims for ~50ms (post-0.21), but pipewire
//!   under gui load (webkit2gtk in tauri) still bursts cpu enough to
//!   underrun at small periods; 2048 frames @ 48k is ~43ms with
//!   plenty of headroom. linux also enables cpal's `pulseaudio`
//!   feature so we route through pulse/pipewire-pulse instead of bare
//!   alsa, which is far more robust on modern desktops.
//!
//! this module is gated behind the `rodio-playback` cargo feature
//! so headless builds can omit cpal entirely.

use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use rodio::mixer::Mixer;
use rodio::source::Buffered;
use rodio::{Decoder, DeviceSinkBuilder, MixerDeviceSink, Player, Source};
use tokio::sync::broadcast;
use tracing::{debug, info, warn};

use crate::error::ErrorDetail;
use crate::player::control::{PlayerCommand, PlayerEvent, PlayerState};

/// progress emission cadence. rodio's `Sink::get_pos` is cheap; ~4
/// hz is plenty for ui smoothness without flooding broadcast
/// subscribers.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);

/// recv timeout for the audio loop. small enough to keep progress
/// events ticking; large enough to avoid burning cpu when idle.
const RECV_TIMEOUT: Duration = Duration::from_millis(100);

/// command sender end. used by the supervisor to forward commands
/// from the broadcast api into the audio thread.
pub type CmdTx = mpsc::Sender<PlayerCommand>;

/// command receiver end. consumed by the audio thread.
pub type CmdRx = mpsc::Receiver<PlayerCommand>;

/// spawn the audio thread. returns a [`std::thread::JoinHandle`]
/// the supervisor uses to detect unexpected exits.
///
/// `cmd_rx` is consumed by the thread; if the corresponding sender
/// is dropped, the thread exits cleanly (returns from `audio_loop`).
pub(crate) fn spawn(
    cmd_rx: CmdRx,
    events: broadcast::Sender<PlayerEvent>,
) -> std::io::Result<thread::JoinHandle<()>> {
    thread::Builder::new()
        .name("freqhole-rodio".into())
        .spawn(move || {
            audio_loop(cmd_rx, events);
        })
}

/// the audio thread's main loop. one of:
/// - returns normally when the command channel hangs up (clean
///   shutdown).
/// - returns early after emitting [`PlayerEvent::Error`] if the
///   audio output device cannot be opened (no cpal default device
///   etc.).
/// - is wrapped in `catch_unwind` by the supervisor; any panic from
///   inside rodio/cpal triggers a [`PlayerEvent::BackendDown`] +
///   restart.
fn audio_loop(cmd_rx: CmdRx, events: broadcast::Sender<PlayerEvent>) {
    // open default output device. failure here is terminal for this
    // run of the loop — supervisor decides whether to retry.
    let stream = match open_device_sink() {
        Ok(s) => {
            info!(
                target: "player",
                config = ?s.config(),
                "[player] rodio backend started; default output stream opened"
            );
            s
        }
        Err(e) => {
            emit(
                &events,
                PlayerEvent::Error {
                    detail: ErrorDetail::new(
                        "audio_device_open_failed",
                        "Audio Device Open Failed",
                        format!("could not open default audio output: {e}"),
                    ),
                },
            );
            return;
        }
    };
    let mixer = stream.mixer();

    let mut sink: Option<Player> = None;
    let mut queue: Vec<String> = Vec::new();
    let mut current_index: Option<usize> = None;
    let mut total_per_track: Vec<Duration> = Vec::new();
    let mut volume: f32 = 1.0;
    let mut last_progress = Instant::now();
    let mut last_state = PlayerState::Stopped;

    emit_state(&events, &mut last_state, PlayerState::Stopped);

    loop {
        // poll the command channel, but timebox so we can also emit
        // progress and ended events between commands.
        match cmd_rx.recv_timeout(RECV_TIMEOUT) {
            Ok(cmd) => handle_command(
                cmd,
                mixer,
                &events,
                &mut sink,
                &mut queue,
                &mut current_index,
                &mut total_per_track,
                &mut volume,
                &mut last_state,
            ),
            Err(mpsc::RecvTimeoutError::Timeout) => { /* tick below */ }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                debug!("rodio: command channel closed; exiting audio loop");
                return;
            }
        }

        // tick: emit progress + detect end-of-queue.
        if let Some(s) = sink.as_ref() {
            let pos = s.get_pos();
            let total = current_index
                .and_then(|i| total_per_track.get(i).copied())
                .unwrap_or(Duration::ZERO);

            if last_progress.elapsed() >= PROGRESS_INTERVAL {
                emit(
                    &events,
                    PlayerEvent::Progress {
                        ms: pos.as_millis().min(u128::from(u64::MAX)) as u64,
                        total_ms: total.as_millis().min(u128::from(u64::MAX)) as u64,
                    },
                );
                last_progress = Instant::now();
            }

            // sink.empty() goes true once the last decoded source has
            // drained. transition to stopped + emit Ended.
            if s.empty() {
                info!(target: "player", "[player] rodio queue drained; emitting Ended");
                sink = None;
                queue.clear();
                total_per_track.clear();
                current_index = None;
                emit(&events, PlayerEvent::Ended);
                emit_state(&events, &mut last_state, PlayerState::Stopped);
            }
        }
    }
}

/// dispatch a single command. all errors are surfaced as
/// [`PlayerEvent::Error`]; nothing here panics.
#[allow(clippy::too_many_arguments)]
fn handle_command(
    cmd: PlayerCommand,
    mixer: &Mixer,
    events: &broadcast::Sender<PlayerEvent>,
    sink: &mut Option<Player>,
    queue: &mut Vec<String>,
    current_index: &mut Option<usize>,
    total_per_track: &mut Vec<Duration>,
    volume: &mut f32,
    last_state: &mut PlayerState,
) {
    match cmd {
        PlayerCommand::Load { paths } => {
            let new_sink = Player::connect_new(mixer);
            new_sink.set_volume(*volume);

            let mut loaded_totals: Vec<Duration> = Vec::with_capacity(paths.len());
            let mut loaded_paths: Vec<String> = Vec::with_capacity(paths.len());
            for p in paths {
                match load_source(&p) {
                    Ok((src, dur)) => {
                        // Sink::append decodes lazily and can panic on
                        // malformed inputs that slipped past the
                        // load_source decoder init. wrap in
                        // catch_unwind so a single bad file doesn't
                        // tear down the audio thread.
                        let path_for_panic = p.clone();
                        let sink_ref = &new_sink;
                        let appended =
                            std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
                                sink_ref.append(src);
                            }));
                        match appended {
                            Ok(()) => {
                                loaded_totals.push(dur);
                                loaded_paths.push(p);
                            }
                            Err(panic) => {
                                let msg = panic_msg(&panic);
                                warn!(
                                    target: "player",
                                    path = %path_for_panic,
                                    panic = %msg,
                                    "[player] rodio Sink::append panicked; skipping track"
                                );
                                emit(
                                    events,
                                    PlayerEvent::Error {
                                        detail: ErrorDetail::new(
                                            "audio_append_panic",
                                            "Audio Append Panic",
                                            format!("{path_for_panic}: {msg}"),
                                        ),
                                    },
                                );
                            }
                        }
                    }
                    Err(detail) => {
                        // skip this track but report it; continue with the rest
                        // so a single bad file doesn't kill the whole queue.
                        emit(events, PlayerEvent::Error { detail });
                    }
                }
            }

            if loaded_paths.is_empty() {
                // nothing playable — leave sink alone, stay stopped.
                emit_state(events, last_state, PlayerState::Stopped);
                return;
            }

            new_sink.play();
            *queue = loaded_paths.clone();
            *total_per_track = loaded_totals;
            *current_index = Some(0);
            *sink = Some(new_sink);

            // index 0 is now playing
            if let Some(p) = loaded_paths.first() {
                // confirmation log so operators can see the rodio path
                // is actually being driven (rather than a silent
                // fall-through to the html element backend in spume).
                info!(
                    target: "player",
                    path = %p,
                    queue_len = loaded_paths.len(),
                    "[player] rodio sink Load: playing track 0"
                );
                emit(
                    events,
                    PlayerEvent::TrackChanged {
                        index: 0,
                        path: p.clone(),
                    },
                );
            }
            emit_state(events, last_state, PlayerState::Playing);
        }
        PlayerCommand::Enqueue { paths } => {
            // if no sink exists yet, treat enqueue as load.
            if sink.is_none() {
                handle_command(
                    PlayerCommand::Load { paths },
                    mixer,
                    events,
                    sink,
                    queue,
                    current_index,
                    total_per_track,
                    volume,
                    last_state,
                );
                return;
            }
            // sink is live; append to it without disturbing playback.
            // we still emit per-track errors for files that fail
            // decoder init or panic during append.
            let Some(active_sink) = sink.as_ref() else {
                return;
            };
            for p in paths {
                match load_source(&p) {
                    Ok((src, dur)) => {
                        let path_for_panic = p.clone();
                        let appended =
                            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                active_sink.append(src);
                            }));
                        match appended {
                            Ok(()) => {
                                queue.push(p.clone());
                                total_per_track.push(dur);
                                info!(
                                    target: "player",
                                    path = %p,
                                    queue_len = queue.len(),
                                    "[player] rodio sink Enqueue: appended track"
                                );
                            }
                            Err(panic) => {
                                let msg = panic_msg(&panic);
                                warn!(
                                    target: "player",
                                    path = %path_for_panic,
                                    panic = %msg,
                                    "[player] rodio Sink::append panicked during enqueue; skipping track"
                                );
                                emit(
                                    events,
                                    PlayerEvent::Error {
                                        detail: ErrorDetail::new(
                                            "audio_append_panic",
                                            "Audio Append Panic",
                                            format!("{path_for_panic}: {msg}"),
                                        ),
                                    },
                                );
                            }
                        }
                    }
                    Err(detail) => {
                        emit(events, PlayerEvent::Error { detail });
                    }
                }
            }
        }
        PlayerCommand::Play => {
            if let Some(s) = sink.as_ref() {
                info!(target: "player", "[player] rodio sink Play");
                s.play();
                emit_state(events, last_state, PlayerState::Playing);
            }
        }
        PlayerCommand::Pause => {
            if let Some(s) = sink.as_ref() {
                info!(target: "player", "[player] rodio sink Pause");
                s.pause();
                emit_state(events, last_state, PlayerState::Paused);
            }
        }
        PlayerCommand::Stop => {
            info!(target: "player", "[player] rodio sink Stop; clearing queue");
            *sink = None;
            queue.clear();
            total_per_track.clear();
            *current_index = None;
            emit_state(events, last_state, PlayerState::Stopped);
        }
        PlayerCommand::Next => {
            info!(target: "player", "[player] rodio sink Next");
            // rodio sinks don't expose per-source skip cleanly; rebuild the
            // sink from `current_index + 1` onward. acceptable for v1
            // because Load/Next/Previous all rebuild the source list.
            advance(
                mixer,
                events,
                sink,
                queue,
                current_index,
                total_per_track,
                *volume,
                1,
                last_state,
            );
        }
        PlayerCommand::Previous => {
            info!(target: "player", "[player] rodio sink Previous");
            advance(
                mixer,
                events,
                sink,
                queue,
                current_index,
                total_per_track,
                *volume,
                -1,
                last_state,
            );
        }
        PlayerCommand::Seek { ms } => {
            if let Some(s) = sink.as_ref() {
                info!(target: "player", ms, "[player] rodio sink Seek");
                let target = Duration::from_millis(ms);
                if let Err(e) = s.try_seek(target) {
                    emit_error(events, "seek_failed", "Seek Failed", format!("{e:?}"));
                }
            }
        }
        PlayerCommand::SetVolume { v } => {
            let clamped = v.clamp(0.0, 2.0);
            info!(target: "player", volume = clamped, "[player] rodio sink SetVolume");
            *volume = clamped;
            if let Some(s) = sink.as_ref() {
                s.set_volume(clamped);
            }
        }
        PlayerCommand::Status => {
            // re-emit current state so a freshly-subscribed consumer
            // can bootstrap.
            let st = if let Some(s) = sink.as_ref() {
                if s.is_paused() {
                    PlayerState::Paused
                } else if s.empty() {
                    PlayerState::Stopped
                } else {
                    PlayerState::Playing
                }
            } else {
                PlayerState::Stopped
            };
            emit(events, PlayerEvent::State { state: st });
        }
    }
}

/// rebuild the sink from a new starting index. used by `Next` /
/// `Previous`. negative deltas walk backward.
#[allow(clippy::too_many_arguments)]
fn advance(
    mixer: &Mixer,
    events: &broadcast::Sender<PlayerEvent>,
    sink: &mut Option<Player>,
    queue: &[String],
    current_index: &mut Option<usize>,
    total_per_track: &mut Vec<Duration>,
    volume: f32,
    delta: i64,
    last_state: &mut PlayerState,
) {
    if queue.is_empty() {
        return;
    }
    let cur = current_index.unwrap_or(0) as i64;
    let next = cur + delta;
    if next < 0 || (next as usize) >= queue.len() {
        // out of bounds — treat as Stop + Ended.
        *sink = None;
        *current_index = None;
        emit(events, PlayerEvent::Ended);
        emit_state(events, last_state, PlayerState::Stopped);
        return;
    }
    let next_idx = next as usize;

    let new_sink = Player::connect_new(mixer);
    new_sink.set_volume(volume);

    let mut new_totals: Vec<Duration> = Vec::new();
    for p in &queue[next_idx..] {
        match load_source(p) {
            Ok((src, dur)) => {
                let path_for_panic = p.clone();
                let sink_ref = &new_sink;
                let appended = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
                    sink_ref.append(src);
                }));
                match appended {
                    Ok(()) => new_totals.push(dur),
                    Err(panic) => {
                        let msg = panic_msg(&panic);
                        warn!(
                            target: "player",
                            path = %path_for_panic,
                            panic = %msg,
                            "[player] rodio Sink::append panicked during advance; skipping track"
                        );
                        emit(
                            events,
                            PlayerEvent::Error {
                                detail: ErrorDetail::new(
                                    "audio_append_panic",
                                    "Audio Append Panic",
                                    format!("{path_for_panic}: {msg}"),
                                ),
                            },
                        );
                        // push a placeholder so the indices stay
                        // aligned with `queue`.
                        new_totals.push(Duration::ZERO);
                    }
                }
            }
            Err(detail) => emit(events, PlayerEvent::Error { detail }),
        }
    }

    new_sink.play();
    *sink = Some(new_sink);
    *current_index = Some(next_idx);

    // adjust total_per_track to align with the new index window: the
    // source-of-truth slice starts at next_idx now, but we keep the
    // full queue length so `current_index` indexing into the original
    // queue stays sensible.
    *total_per_track = {
        let mut v = vec![Duration::ZERO; next_idx];
        v.extend(new_totals);
        v
    };

    if let Some(p) = queue.get(next_idx) {
        info!(
            target: "player",
            path = %p,
            index = next_idx,
            "[player] rodio sink advance: playing next track"
        );
        emit(
            events,
            PlayerEvent::TrackChanged {
                index: next_idx as u32,
                path: p.clone(),
            },
        );
    }
    emit_state(events, last_state, PlayerState::Playing);
}

/// open a file path and decode it into a rodio source. returns the
/// decoded source plus its total duration (zero if unknown).
///
/// pre-validates the file (exists, non-empty, plausible audio
/// extension) before invoking the decoder, and wraps the
/// `Decoder::new` call in `catch_unwind` because rodio's symphonia
/// adapter (rodio 0.20.x) can panic on malformed/seek-unsupported
/// streams during initialization rather than returning an Err. we
/// convert any such panic into an `ErrorDetail` so the supervisor
/// loop survives and can advance to the next queued track.
fn load_source(
    path: &str,
) -> Result<
    (
        Buffered<Decoder<std::io::BufReader<std::fs::File>>>,
        Duration,
    ),
    ErrorDetail,
> {
    let p = std::path::Path::new(path);
    if !p.exists() {
        return Err(ErrorDetail::new(
            "audio_file_missing",
            "Audio File Missing",
            format!("{path}: file does not exist"),
        ));
    }
    let meta = std::fs::metadata(p).map_err(|e| {
        ErrorDetail::new(
            "audio_file_stat_failed",
            "Audio File Stat Failed",
            format!("{path}: {e}"),
        )
    })?;
    if meta.len() == 0 {
        return Err(ErrorDetail::new(
            "audio_file_empty",
            "Audio File Empty",
            format!("{path}: zero-byte file"),
        ));
    }
    // soft extension check: warn-only for unusual extensions, but
    // still attempt to decode (rodio/symphonia auto-detects most).
    let ext_ok = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            matches!(
                e.to_ascii_lowercase().as_str(),
                "mp3" | "m4a" | "mp4" | "aac" | "flac" | "ogg" | "oga" | "opus" | "wav" | "wave"
            )
        })
        .unwrap_or(false);
    if !ext_ok {
        warn!(
            target: "player",
            path = %path,
            "[player] unusual audio extension; attempting decode anyway"
        );
    }
    let file = std::fs::File::open(path).map_err(|e| {
        ErrorDetail::new(
            "audio_file_open_failed",
            "Audio File Open Failed",
            format!("{path}: {e}"),
        )
    })?;
    // wrap Decoder::try_from in catch_unwind: rodio's symphonia
    // adapter has historically panicked on certain malformed inputs
    // during init rather than returning Err. AssertUnwindSafe is
    // needed because File isn't declared UnwindSafe, but it's safe
    // here since we drop it on panic and don't observe broken state.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
        Decoder::try_from(file)
    }));
    let src = match result {
        Ok(Ok(src)) => src,
        Ok(Err(e)) => {
            return Err(ErrorDetail::new(
                "audio_decode_failed",
                "Audio Decode Failed",
                format!("{path}: {e}"),
            ));
        }
        Err(panic) => {
            let msg = panic_msg(&panic);
            warn!(
                target: "player",
                path = %path,
                panic = %msg,
                "[player] rodio decoder panicked during init; treating as decode error"
            );
            return Err(ErrorDetail::new(
                "audio_decoder_panic",
                "Audio Decoder Panic",
                format!("{path}: {msg}"),
            ));
        }
    };
    let dur = src.total_duration().unwrap_or(Duration::ZERO);
    // wrap in Source::buffered() so disk-read stalls don't starve the
    // cpal mixer. cheap insurance on top of the larger cpal period
    // we set on linux; harmless elsewhere.
    Ok((src.buffered(), dur))
}

/// open the default audio output device. on linux we explicitly
/// request a `BufferSize::Fixed(2048)` period (~43ms @ 48k) which is
/// the consensus fix for pipewire/pulseaudio underruns under gui
/// load — see rodio#827. on other targets we let rodio pick its
/// default (which post-0.21 already aims for ~50ms).
fn open_device_sink() -> Result<MixerDeviceSink, rodio::stream::DeviceSinkError> {
    #[cfg(target_os = "linux")]
    {
        DeviceSinkBuilder::from_default_device()?
            .with_buffer_size(cpal::BufferSize::Fixed(2048))
            .open_sink_or_fallback()
    }
    #[cfg(not(target_os = "linux"))]
    {
        DeviceSinkBuilder::open_default_sink()
    }
}

/// extract a best-effort string message from a `catch_unwind`
/// payload. rodio/symphonia panic with `&'static str` payloads in
/// most cases; format!() panics produce `String`. anything else
/// gets a generic placeholder so callers don't have to.
fn panic_msg(panic: &Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = panic.downcast_ref::<&'static str>() {
        (*s).to_string()
    } else if let Some(s) = panic.downcast_ref::<String>() {
        s.clone()
    } else {
        "decoder panicked".to_string()
    }
}

/// emit an event; quietly drop if no subscribers.
fn emit(events: &broadcast::Sender<PlayerEvent>, ev: PlayerEvent) {
    let _ = events.send(ev);
}

/// emit a state event only if it's a transition.
fn emit_state(events: &broadcast::Sender<PlayerEvent>, last: &mut PlayerState, next: PlayerState) {
    if *last != next {
        *last = next;
        emit(events, PlayerEvent::State { state: next });
    }
}

/// helper for one-line error emission.
fn emit_error(
    events: &broadcast::Sender<PlayerEvent>,
    error_type: &str,
    title: &str,
    detail: impl ToString,
) {
    warn!("rodio: {error_type}: {}", detail.to_string());
    emit(
        events,
        PlayerEvent::Error {
            detail: ErrorDetail::new(error_type, title, detail.to_string()),
        },
    );
}

// note: no unit tests in this module. headless rodio testing requires a
// dummy audio backend that cpal does not provide on all targets, and
// the supervisor in `super::supervisor` exercises the channel
// plumbing without needing a real sink. integration tests that
// actually open the default device live in `cli/tests/`.
