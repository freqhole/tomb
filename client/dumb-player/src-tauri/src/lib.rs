// barebones tauri app: pick an audio file, read bytes via ipc, play via blob: URL.
// mirrors freqhole's playback path (in-memory bytes -> Blob -> <audio>).

use std::fs::File;
use std::io::BufReader;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use rodio::{Decoder, OutputStream, Sink, Source};
use tauri::{Manager, State};

#[tauri::command]
async fn read_audio_file(path: String) -> Result<Vec<u8>, String> {
    tokio::fs::read(&path).await.map_err(|e| e.to_string())
}

// --- option F: native rodio playback ---
//
// rodio's OutputStream and Sink are NOT Send + Sync (they hold raw audio
// device handles). so we can't store them directly in tauri's State.
// instead we spawn a dedicated audio thread that owns them, and tauri
// commands send messages to it via an mpsc channel. shared status (for
// position polling) lives in an Arc<Mutex<RodioStatus>> the audio thread
// updates and commands read.

#[derive(Clone, Default, serde::Serialize)]
struct RodioStatus {
    has_sink: bool,
    is_paused: bool,
    queue_len: usize,
    position_secs: f64,
    total_secs: f64,
    volume: f32,
}

enum RodioCmd {
    Play(Vec<String>),
    Pause,
    Resume,
    Stop,
    SetVolume(f32),
    Seek(f64),
}

struct RodioState {
    tx: Sender<RodioCmd>,
    status: Arc<Mutex<RodioStatus>>,
    last_play_error: Arc<Mutex<Option<String>>>,
}

fn spawn_audio_thread() -> Result<RodioState, String> {
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
            // open default output once. if it fails, the thread exits and
            // every command will report channel-closed.
            let (_stream, handle) = match OutputStream::try_default() {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("rodio audio thread: failed to open default output: {e}");
                    *err_clone.lock().unwrap() = Some(format!("open default output: {e}"));
                    return;
                }
            };

            let mut sink: Option<Sink> = None;
            let mut total = Duration::ZERO;
            let mut volume: f32 = 1.0;

            // periodic status refresh: poll the channel with a short timeout
            // so we can update position even when no commands are arriving.
            loop {
                let msg = rx.recv_timeout(Duration::from_millis(200));
                match msg {
                    Ok(RodioCmd::Play(paths)) => {
                        // build a fresh sink for the new queue
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
                            // sink dropped here -> stops itself
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
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        // just fall through to status update
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        eprintln!("rodio audio thread: channel disconnected, exiting");
                        return;
                    }
                }

                // update shared status snapshot
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

#[tauri::command]
fn rodio_play(paths: Vec<String>, state: State<'_, RodioState>) -> Result<f64, String> {
    if paths.is_empty() {
        return Err("no paths".to_string());
    }
    *state.last_play_error.lock().unwrap() = None;
    state
        .tx
        .send(RodioCmd::Play(paths))
        .map_err(|e| e.to_string())?;
    // give the audio thread a moment to decode + populate status
    for _ in 0..20 {
        thread::sleep(Duration::from_millis(25));
        if let Some(err) = state.last_play_error.lock().unwrap().clone() {
            return Err(err);
        }
        let s = state.status.lock().unwrap();
        if s.has_sink {
            return Ok(s.total_secs);
        }
    }
    // no error and no sink yet — return 0 and let polling pick it up
    Ok(0.0)
}

#[tauri::command]
fn rodio_pause(state: State<'_, RodioState>) -> Result<(), String> {
    state.tx.send(RodioCmd::Pause).map_err(|e| e.to_string())
}

#[tauri::command]
fn rodio_resume(state: State<'_, RodioState>) -> Result<(), String> {
    state.tx.send(RodioCmd::Resume).map_err(|e| e.to_string())
}

#[tauri::command]
fn rodio_stop(state: State<'_, RodioState>) -> Result<(), String> {
    state.tx.send(RodioCmd::Stop).map_err(|e| e.to_string())
}

#[tauri::command]
fn rodio_set_volume(volume: f32, state: State<'_, RodioState>) -> Result<(), String> {
    state
        .tx
        .send(RodioCmd::SetVolume(volume))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn rodio_seek(seconds: f64, state: State<'_, RodioState>) -> Result<(), String> {
    *state.last_play_error.lock().unwrap() = None;
    state
        .tx
        .send(RodioCmd::Seek(seconds))
        .map_err(|e| e.to_string())?;
    // give the worker a tick to attempt the seek and report any error
    thread::sleep(Duration::from_millis(50));
    if let Some(err) = state.last_play_error.lock().unwrap().clone() {
        return Err(err);
    }
    Ok(())
}

#[tauri::command]
fn rodio_status(state: State<'_, RodioState>) -> RodioStatus {
    state.status.lock().unwrap().clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // initialize the rodio audio thread. if it fails (no audio
            // device, etc) we log and continue without F enabled.
            match spawn_audio_thread() {
                Ok(state) => {
                    app.manage(state);
                    eprintln!("rodio: audio thread spawned");
                }
                Err(e) => {
                    eprintln!("rodio init failed (option F unavailable): {e}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_audio_file,
            rodio_play,
            rodio_pause,
            rodio_resume,
            rodio_stop,
            rodio_set_volume,
            rodio_seek,
            rodio_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
