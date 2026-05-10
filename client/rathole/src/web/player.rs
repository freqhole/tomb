//! `HtmlAudioPlayer` — a `MusicPlayer` impl backed by a single
//! `<audio>` element appended to `document.body` (off-screen).
//! handles queue management entirely in rust: `PlayerCmd::Load`
//! accepts a list of urls, plays the first one, and `Next`/`Previous`
//! jump within the queue. dom audio events (`play`, `pause`, `ended`,
//! `timeupdate`, `loadedmetadata`, `error`) are bridged onto the
//! `AppAction::MusicEvent` channel so the existing ratcore music view
//! handles ui updates uniformly with the tty shell.
//!
//! NOTE: this player takes URL strings directly. wiring url
//! *resolution* (blob_id → server `/api/blobs/{id}/data` → object url)
//! is a follow-up; for now `PlayerCmd::Load(urls)` is expected to
//! receive ready-to-play urls (e.g. from a future `Transport::resolve_blob_url`
//! method or, eventually, the spume music-runtime integration).

use async_trait::async_trait;
use futures::channel::mpsc;
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::JsCast;
use web_sys::HtmlAudioElement;

use crate::ratcore::app::{AppAction, MusicEvent, PlayerState};
use crate::ratcore::transport::{MusicPlayer, PlayerCmd};

pub struct HtmlAudioPlayer {
    inner: Rc<RefCell<Inner>>,
}

struct Inner {
    el: HtmlAudioElement,
    queue: Vec<String>,
    cursor: usize,
    volume: f32,
    tx: mpsc::UnboundedSender<AppAction>,
    /// keep closures alive for the lifetime of the player. dropping
    /// these unbinds the dom listeners.
    _listeners: Vec<Closure<dyn FnMut(web_sys::Event)>>,
    /// last reported state, used to dedupe noisy timeupdate events.
    last_state: Cell<PlayerState>,
}

impl HtmlAudioPlayer {
    /// build a hidden `<audio>` element, attach event listeners, and
    /// return a player ready to be wrapped in `Rc<dyn MusicPlayer>`.
    pub fn spawn(tx: mpsc::UnboundedSender<AppAction>) -> Result<Rc<Self>, String> {
        let window = web_sys::window().ok_or("no window")?;
        let document = window.document().ok_or("no document")?;
        let el = document
            .create_element("audio")
            .map_err(|e| format!("create_element audio: {e:?}"))?
            .dyn_into::<HtmlAudioElement>()
            .map_err(|_| "audio element cast failed".to_string())?;
        // off-screen but still reachable by the dom events api.
        el.set_attribute("style", "display:none")
            .map_err(|e| format!("set style: {e:?}"))?;
        el.set_preload("auto");
        document
            .body()
            .ok_or("no body")?
            .append_child(&el)
            .map_err(|e| format!("append audio: {e:?}"))?;

        let inner = Rc::new(RefCell::new(Inner {
            el: el.clone(),
            queue: Vec::new(),
            cursor: 0,
            volume: 1.0,
            tx: tx.clone(),
            _listeners: Vec::new(),
            last_state: Cell::new(PlayerState::Stopped),
        }));

        // wire dom events. each closure borrows `inner` weakly via Rc
        // clone; closures stay alive in `_listeners`.
        let mut listeners: Vec<Closure<dyn FnMut(web_sys::Event)>> = Vec::new();

        // play
        {
            let inner_c = inner.clone();
            let cb = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
                let inner = inner_c.borrow();
                inner.last_state.set(PlayerState::Playing);
                let _ = inner
                    .tx
                    .unbounded_send(AppAction::MusicEvent(MusicEvent::State(
                        PlayerState::Playing,
                    )));
            });
            el.add_event_listener_with_callback("play", cb.as_ref().unchecked_ref())
                .map_err(|e| format!("add play listener: {e:?}"))?;
            listeners.push(cb);
        }

        // pause
        {
            let inner_c = inner.clone();
            let cb = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
                let inner = inner_c.borrow();
                // ignore pause events that fire when the element ends —
                // those are followed by an explicit ended event we want
                // to drive the state transition instead.
                if inner.el.ended() {
                    return;
                }
                inner.last_state.set(PlayerState::Paused);
                let _ = inner
                    .tx
                    .unbounded_send(AppAction::MusicEvent(MusicEvent::State(
                        PlayerState::Paused,
                    )));
            });
            el.add_event_listener_with_callback("pause", cb.as_ref().unchecked_ref())
                .map_err(|e| format!("add pause listener: {e:?}"))?;
            listeners.push(cb);
        }

        // ended → advance queue or report ended
        {
            let inner_c = inner.clone();
            let cb = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
                let mut inner = inner_c.borrow_mut();
                inner.cursor = inner.cursor.saturating_add(1);
                if inner.cursor < inner.queue.len() {
                    let url = inner.queue[inner.cursor].clone();
                    let idx = inner.cursor;
                    inner.el.set_src(&url);
                    let _ = inner.el.play();
                    let _ =
                        inner
                            .tx
                            .unbounded_send(AppAction::MusicEvent(MusicEvent::TrackChanged {
                                index: idx,
                                path: url,
                            }));
                } else {
                    inner.last_state.set(PlayerState::Stopped);
                    let _ = inner
                        .tx
                        .unbounded_send(AppAction::MusicEvent(MusicEvent::Ended));
                    let _ = inner
                        .tx
                        .unbounded_send(AppAction::MusicEvent(MusicEvent::State(
                            PlayerState::Stopped,
                        )));
                }
            });
            el.add_event_listener_with_callback("ended", cb.as_ref().unchecked_ref())
                .map_err(|e| format!("add ended listener: {e:?}"))?;
            listeners.push(cb);
        }

        // timeupdate → progress
        {
            let inner_c = inner.clone();
            let cb = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
                let inner = inner_c.borrow();
                let cur = inner.el.current_time();
                let dur = inner.el.duration();
                let ms = (cur * 1000.0) as u64;
                let total = if dur.is_finite() {
                    (dur * 1000.0) as u64
                } else {
                    0
                };
                let _ = inner
                    .tx
                    .unbounded_send(AppAction::MusicEvent(MusicEvent::Progress {
                        ms,
                        total_ms: total,
                    }));
            });
            el.add_event_listener_with_callback("timeupdate", cb.as_ref().unchecked_ref())
                .map_err(|e| format!("add timeupdate listener: {e:?}"))?;
            listeners.push(cb);
        }

        // loadedmetadata → state Loading -> (Playing if autoplay
        // succeeds; otherwise Paused). we report Loading on Load
        // rather than here so the ui sees the spinner sooner.

        // error
        {
            let inner_c = inner.clone();
            let cb = Closure::<dyn FnMut(_)>::new(move |_e: web_sys::Event| {
                let inner = inner_c.borrow();
                // HtmlAudioElement.error is a MediaError or null. read
                // it via a generic js property lookup so we don't have
                // to enable the MediaError web-sys feature.
                let detail = match js_sys::Reflect::get(inner.el.as_ref(), &"error".into()) {
                    Ok(err) if !err.is_null() && !err.is_undefined() => {
                        match js_sys::Reflect::get(&err, &"code".into()) {
                            Ok(c) => format!(
                                "audio error code {}",
                                c.as_f64().map(|f| f as i32).unwrap_or(-1)
                            ),
                            Err(_) => "audio error".to_string(),
                        }
                    }
                    _ => "audio error".to_string(),
                };
                let _ = inner
                    .tx
                    .unbounded_send(AppAction::MusicEvent(MusicEvent::Error(detail)));
                inner.last_state.set(PlayerState::Stopped);
                let _ = inner
                    .tx
                    .unbounded_send(AppAction::MusicEvent(MusicEvent::State(
                        PlayerState::Stopped,
                    )));
            });
            el.add_event_listener_with_callback("error", cb.as_ref().unchecked_ref())
                .map_err(|e| format!("add error listener: {e:?}"))?;
            listeners.push(cb);
        }

        inner.borrow_mut()._listeners = listeners;
        Ok(Rc::new(Self { inner }))
    }
}

#[async_trait(?Send)]
impl MusicPlayer for HtmlAudioPlayer {
    async fn send(&self, cmd: PlayerCmd) -> Result<(), String> {
        let mut inner = self.inner.borrow_mut();
        match cmd {
            PlayerCmd::Load(paths) => {
                if paths.is_empty() {
                    return Err("empty queue".to_string());
                }
                inner.queue = paths;
                inner.cursor = 0;
                let url = inner.queue[0].clone();
                inner.el.set_volume(inner.volume as f64);
                inner.el.set_src(&url);
                inner.last_state.set(PlayerState::Loading);
                let _ = inner
                    .tx
                    .unbounded_send(AppAction::MusicEvent(MusicEvent::State(
                        PlayerState::Loading,
                    )));
                let _ = inner
                    .tx
                    .unbounded_send(AppAction::MusicEvent(MusicEvent::TrackChanged {
                        index: 0,
                        path: url,
                    }));
                // play() returns a promise; ignore it — the `play`
                // event listener will drive the state change once
                // the browser actually starts playback.
                let _ = inner.el.play();
            }
            PlayerCmd::Enqueue(paths) => {
                if paths.is_empty() {
                    return Ok(());
                }
                if inner.queue.is_empty() {
                    // nothing playing — promote enqueue to a load so
                    // the audio element actually starts.
                    inner.queue = paths;
                    inner.cursor = 0;
                    let url = inner.queue[0].clone();
                    inner.el.set_volume(inner.volume as f64);
                    inner.el.set_src(&url);
                    inner.last_state.set(PlayerState::Loading);
                    let _ = inner
                        .tx
                        .unbounded_send(AppAction::MusicEvent(MusicEvent::State(
                            PlayerState::Loading,
                        )));
                    let _ =
                        inner
                            .tx
                            .unbounded_send(AppAction::MusicEvent(MusicEvent::TrackChanged {
                                index: 0,
                                path: url,
                            }));
                    let _ = inner.el.play();
                } else {
                    inner.queue.extend(paths);
                }
            }
            PlayerCmd::Play => {
                let _ = inner.el.play();
            }
            PlayerCmd::Pause => {
                let _ = inner.el.pause();
            }
            PlayerCmd::Stop => {
                let _ = inner.el.pause();
                inner.el.set_current_time(0.0);
                inner.last_state.set(PlayerState::Stopped);
                let _ = inner
                    .tx
                    .unbounded_send(AppAction::MusicEvent(MusicEvent::State(
                        PlayerState::Stopped,
                    )));
            }
            PlayerCmd::Next => {
                if inner.cursor + 1 < inner.queue.len() {
                    inner.cursor += 1;
                    let url = inner.queue[inner.cursor].clone();
                    let idx = inner.cursor;
                    inner.el.set_src(&url);
                    let _ = inner.el.play();
                    let _ =
                        inner
                            .tx
                            .unbounded_send(AppAction::MusicEvent(MusicEvent::TrackChanged {
                                index: idx,
                                path: url,
                            }));
                }
            }
            PlayerCmd::Previous => {
                if inner.cursor > 0 {
                    inner.cursor -= 1;
                    let url = inner.queue[inner.cursor].clone();
                    let idx = inner.cursor;
                    inner.el.set_src(&url);
                    let _ = inner.el.play();
                    let _ =
                        inner
                            .tx
                            .unbounded_send(AppAction::MusicEvent(MusicEvent::TrackChanged {
                                index: idx,
                                path: url,
                            }));
                }
            }
            PlayerCmd::Seek(ms) => {
                let secs = (ms as f64) / 1000.0;
                inner.el.set_current_time(secs);
            }
            PlayerCmd::SetVolume(v) => {
                let clamped = v.clamp(0.0, 1.0);
                inner.volume = clamped;
                inner.el.set_volume(clamped as f64);
            }
        }
        Ok(())
    }
}
