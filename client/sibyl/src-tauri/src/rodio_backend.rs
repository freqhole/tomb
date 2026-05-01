//! rodio playback backend (tauri-only). this is **scaffolding**:
//! lifted verbatim from dumb-player option F. plays a list of file
//! paths from disk via cpal+symphonia. nothing here is part of the
//! `sibyl-core` library — it'll get wired into a sibyl `RodioPlayer`
//! abstraction later that can also accept in-memory chunk streams.

use std::fs::File;
use std::io::BufReader;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use rodio::{Decoder, OutputStream, Sink, Source};

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct RodioStatus {
    pub has_sink: bool,
    pub is_paused: bool,
    pub queue_len: usize,
    pub position_secs: f64,
    pub total_secs: f64,
    pub volume: f32,
}

pub enum RodioCmd {
    Play(Vec<String>),
    Pause,
    Resume,
    Stop,
    SetVolume(f32),
    Seek(f64),
}

pub struct RodioState {
    pub tx: Sender<RodioCmd>,
    pub status: Arc<Mutex<RodioStatus>>,
    pub last_play_error: Arc<Mutex<Option<String>>>,
}

pub fn spawn_audio_thread() -> Result<RodioState, String> {
    let (tx, rx) = channel::<RodioCmd>();
    let status = Arc::new(Mutex::new(RodioStatus {
        volume: 1.0,
        ..Default::default()
    }));
    let last_play_error = Arc::new(Mutex::new(None));

    let status_clone = status.clone();
    let err_clone = last_play_error.clone();

    thread::Builder::new()
        .name("rodio-audio".into())
        .spawn(move || {
            let (_stream, handle) = match OutputStream::try_default() {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("rodio: failed to open default output: {e}");
                    *err_clone.lock().unwrap() = Some(format!("open default output: {e}"));
                    return;
                }
            };

            let mut sink: Option<Sink> = None;
            let mut total = Duration::ZERO;
            let mut volume: f32 = 1.0;

            loop {
                let msg = rx.recv_timeout(Duration::from_millis(200));
                match msg {
                    Ok(RodioCmd::Play(paths)) => {
                        let new_sink = match Sink::try_new(&handle) {
                            Ok(s) => s,
                            Err(e) => {
                                *err_clone.lock().unwrap() = Some(format!("create sink: {e}"));
                                continue;
                            }
                        };
                        new_sink.set_volume(volume);
                        let mut t = Duration::ZERO;
                        let mut decode_err: Option<String> = None;
                        for p in &paths {
                            match File::open(p) {
                                Ok(file) => match Decoder::new(BufReader::new(file)) {
                                    Ok(src) => {
                                        if let Some(d) = src.total_duration() {
                                            t += d;
                                        }
                                        new_sink.append(src);
                                    }
                                    Err(e) => {
                                        decode_err = Some(format!("decode {p}: {e}"));
                                        break;
                                    }
                                },
                                Err(e) => {
                                    decode_err = Some(format!("open {p}: {e}"));
                                    break;
                                }
                            }
                        }
                        if let Some(e) = decode_err {
                            *err_clone.lock().unwrap() = Some(e);
                            sink = None;
                            total = Duration::ZERO;
                        } else {
                            new_sink.play();
                            sink = Some(new_sink);
                            total = t;
                            *err_clone.lock().unwrap() = None;
                        }
                    }
                    Ok(RodioCmd::Pause) => {
                        if let Some(s) = sink.as_ref() {
                            s.pause();
                        }
                    }
                    Ok(RodioCmd::Resume) => {
                        if let Some(s) = sink.as_ref() {
                            s.play();
                        }
                    }
                    Ok(RodioCmd::Stop) => {
                        sink = None;
                        total = Duration::ZERO;
                    }
                    Ok(RodioCmd::SetVolume(v)) => {
                        volume = v.clamp(0.0, 2.0);
                        if let Some(s) = sink.as_ref() {
                            s.set_volume(volume);
                        }
                    }
                    Ok(RodioCmd::Seek(secs)) => {
                        if let Some(s) = sink.as_ref() {
                            if let Err(e) = s.try_seek(Duration::from_secs_f64(secs.max(0.0))) {
                                *err_clone.lock().unwrap() = Some(format!("seek failed: {e:?}"));
                            }
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        eprintln!("rodio: channel disconnected, exiting");
                        return;
                    }
                }

                let snap = if let Some(s) = sink.as_ref() {
                    RodioStatus {
                        has_sink: true,
                        is_paused: s.is_paused(),
                        queue_len: s.len(),
                        position_secs: s.get_pos().as_secs_f64(),
                        total_secs: total.as_secs_f64(),
                        volume,
                    }
                } else {
                    RodioStatus {
                        has_sink: false,
                        is_paused: false,
                        queue_len: 0,
                        position_secs: 0.0,
                        total_secs: 0.0,
                        volume,
                    }
                };
                *status_clone.lock().unwrap() = snap;
            }
        })
        .map_err(|e| format!("spawn audio thread: {e}"))?;

    Ok(RodioState {
        tx,
        status,
        last_play_error,
    })
}
