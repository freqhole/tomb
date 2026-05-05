//! rodio audio backend.
//!
//! takes [`PlayerCommand`]s on an mpsc receiver, drives a rodio
//! [`Sink`] on a dedicated audio thread, and emits [`PlayerEvent`]s
//! to a broadcast channel.
//!
//! design notes:
//!
//! - rodio + cpal are blocking apis with strong thread-affinity for
//!   the [`OutputStream`] (it owns the cpal device handle and is not
//!   `Send`). we keep it on a dedicated `std::thread` and bridge to
//!   tokio via channels.
//! - **no `unwrap` / `expect` / `panic!`** in the audio loop. every
//!   error path emits a structured [`PlayerEvent::Error`] and keeps
//!   the loop alive. only an unexpected return from [`audio_loop`]
//!   triggers the supervisor's restart logic.
//! - the loop polls the command channel with a short timeout so it
//!   can also emit ~4 hz progress events while playing.
//!
//! this module is gated behind the `rodio-playback` cargo feature
//! so headless builds can omit cpal entirely.

use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use rodio::{Decoder, OutputStream, Sink, Source};
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
    let (_stream, handle) = match OutputStream::try_default() {
        Ok(p) => {
            info!(target: "player", "[player] rodio backend started; default output stream opened");
            p
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

    let mut sink: Option<Sink> = None;
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
                &handle,
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
    handle: &rodio::OutputStreamHandle,
    events: &broadcast::Sender<PlayerEvent>,
    sink: &mut Option<Sink>,
    queue: &mut Vec<String>,
    current_index: &mut Option<usize>,
    total_per_track: &mut Vec<Duration>,
    volume: &mut f32,
    last_state: &mut PlayerState,
) {
    match cmd {
        PlayerCommand::Load { paths } => {
            let new_sink = match Sink::try_new(handle) {
                Ok(s) => s,
                Err(e) => {
                    emit_error(events, "sink_create_failed", "Sink Create Failed", e);
                    return;
                }
            };
            new_sink.set_volume(*volume);

            let mut loaded_totals: Vec<Duration> = Vec::with_capacity(paths.len());
            let mut loaded_paths: Vec<String> = Vec::with_capacity(paths.len());
            for p in paths {
                match load_source(&p) {
                    Ok((src, dur)) => {
                        loaded_totals.push(dur);
                        loaded_paths.push(p);
                        new_sink.append(src);
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
                handle,
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
                handle,
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
    handle: &rodio::OutputStreamHandle,
    events: &broadcast::Sender<PlayerEvent>,
    sink: &mut Option<Sink>,
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

    let new_sink = match Sink::try_new(handle) {
        Ok(s) => s,
        Err(e) => {
            emit_error(events, "sink_create_failed", "Sink Create Failed", e);
            return;
        }
    };
    new_sink.set_volume(volume);

    let mut new_totals: Vec<Duration> = Vec::new();
    for p in &queue[next_idx..] {
        match load_source(p) {
            Ok((src, dur)) => {
                new_totals.push(dur);
                new_sink.append(src);
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
fn load_source(
    path: &str,
) -> Result<(Decoder<std::io::BufReader<std::fs::File>>, Duration), ErrorDetail> {
    let file = std::fs::File::open(path).map_err(|e| {
        ErrorDetail::new(
            "audio_file_open_failed",
            "Audio File Open Failed",
            format!("{path}: {e}"),
        )
    })?;
    let src = Decoder::new(std::io::BufReader::new(file)).map_err(|e| {
        ErrorDetail::new(
            "audio_decode_failed",
            "Audio Decode Failed",
            format!("{path}: {e}"),
        )
    })?;
    let dur = src.total_duration().unwrap_or(Duration::ZERO);
    Ok((src, dur))
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
