// linux separate video window, built on `gstreamer-play` (GstPlay) + gtksink.
//
// NOTE: none of this compiles on the macOS dev machine - `cargo check` there
// only ever sees the stub in `mod.rs`. it is deliberately thin and mechanical
// for that reason; everything with real logic lives in `backend.rs`, which does
// compile and is unit-tested everywhere.
//
// threading: gtk is not `Send`, so the window and `Play` live on the main
// (gtk) thread and every command is marshalled there with `run_on_main_thread`.
// the `PlaySignalAdapter` also delivers on the main loop, so event translation
// stays on one thread.

use std::cell::RefCell;

use gstreamer as gst;
use gstreamer_play::{Play, PlaySignalAdapter, PlayState, PlayVideoRenderer};
// gdk/glib come from gtk's re-exports so their versions can never drift from
// gtk's own. importing only gtk's prelude also avoids the ambiguous `Cast`
// that comes from having both gst's and gtk's preludes in scope.
use gtk::prelude::*;
use gtk::{gdk, glib};
use tauri::{AppHandle, Wry};

use super::backend::{classify_error, PlayerState, VideoCommand, VideoEvent};
use super::emit_event;

thread_local! {
    /// the single live video window, if any. main-thread only.
    static WINDOW: RefCell<Option<VideoWindow>> = const { RefCell::new(None) };
}

struct VideoWindow {
    play: Play,
    window: gtk::Window,
    /// chrome strip, hidden while fullscreen
    chrome: gtk::Widget,
    /// auto-hiding controls shown over the video while fullscreen
    fullscreen_controls: gtk::Widget,
    state: PlayerState,
}

/// entry point from the tauri command. hops to the gtk main thread.
pub fn dispatch(app: AppHandle<Wry>, command: VideoCommand) -> Result<(), String> {
    let app_for_main = app.clone();
    app.run_on_main_thread(move || {
        if let Err(e) = handle_on_main(&app_for_main, command) {
            emit_event(
                &app_for_main,
                &VideoEvent::Error {
                    error_type: classify_error(&e).to_string(),
                    message: e,
                },
            );
        }
    })
    .map_err(|e| e.to_string())
}

fn handle_on_main(app: &AppHandle<Wry>, command: VideoCommand) -> Result<(), String> {
    match command {
        VideoCommand::Load {
            path,
            title,
            start_seconds,
        } => open_or_reuse(app, &path, title.as_deref(), start_seconds),
        other => with_window(|w| {
            // resolve toggles against real state before touching the pipeline
            let resolved = match other {
                VideoCommand::TogglePlay => w.state.resolve_toggle(),
                VideoCommand::ToggleFullscreen => VideoCommand::SetFullscreen {
                    fullscreen: !w.state.fullscreen,
                },
                c => c,
            };
            w.state.apply_command(&resolved);
            apply(w, &resolved)
        }),
    }
}

fn with_window(f: impl FnOnce(&mut VideoWindow) -> Result<(), String>) -> Result<(), String> {
    WINDOW.with(|cell| match cell.borrow_mut().as_mut() {
        Some(w) => f(w),
        None => Err("no video window is open".to_string()),
    })
}

fn apply(w: &mut VideoWindow, command: &VideoCommand) -> Result<(), String> {
    match command {
        VideoCommand::Play => w.play.play(),
        VideoCommand::Pause => w.play.pause(),
        VideoCommand::Seek { seconds } => w
            .play
            .seek(gst::ClockTime::from_mseconds((seconds * 1000.0) as u64)),
        VideoCommand::SetVolume { volume } => w.play.set_volume(*volume),
        VideoCommand::SetFullscreen { fullscreen } => set_fullscreen(w, *fullscreen),
        VideoCommand::Close => close_window(),
        // Load is handled before this point; toggles are resolved by the caller
        VideoCommand::Load { .. } | VideoCommand::TogglePlay | VideoCommand::ToggleFullscreen => {}
    }
    Ok(())
}

fn set_fullscreen(w: &mut VideoWindow, fullscreen: bool) {
    if fullscreen {
        w.window.fullscreen();
        w.chrome.hide();
        w.fullscreen_controls.show();
    } else {
        w.window.unfullscreen();
        w.chrome.show();
        w.fullscreen_controls.hide();
    }
}

fn close_window() {
    WINDOW.with(|cell| {
        if let Some(w) = cell.borrow_mut().take() {
            w.play.stop();
            w.window.close();
        }
    });
}

/// open the window (creating it on first use) and start the given file.
fn open_or_reuse(
    app: &AppHandle<Wry>,
    path: &str,
    title: Option<&str>,
    start_seconds: Option<f64>,
) -> Result<(), String> {
    // idempotent + refcounted; webkitgtk has already initialized gstreamer in
    // this process, so this should be a no-op rather than a second init.
    gst::init().map_err(|e| format!("gstreamer init failed: {e}"))?;

    let already_open = WINDOW.with(|cell| cell.borrow().is_some());
    if !already_open {
        let w = build_window(app)?;
        WINDOW.with(|cell| *cell.borrow_mut() = Some(w));
    }

    // gstreamer wants a uri, not a path. `glib::filename_to_uri` handles the
    // percent-encoding that a naive `format!("file://{path}")` would get wrong
    // for spaces and non-ascii filenames.
    let uri =
        glib::filename_to_uri(path, None).map_err(|e| format!("bad video path {path}: {e}"))?;

    with_window(|w| {
        w.state = PlayerState::default();
        w.state.apply_command(&VideoCommand::Load {
            path: path.to_string(),
            title: title.map(str::to_string),
            start_seconds,
        });
        w.window.set_title(title.unwrap_or("video"));
        w.play.set_uri(Some(uri.as_str()));
        w.play.play();
        if let Some(start) = start_seconds.filter(|s| *s > 0.0) {
            w.play
                .seek(gst::ClockTime::from_mseconds((start * 1000.0) as u64));
        }
        w.window.show_all();
        w.fullscreen_controls.hide();
        w.window.present();
        Ok(())
    })
}

fn build_window(app: &AppHandle<Wry>) -> Result<VideoWindow, String> {
    // gtksink gives us a real GTK widget, so GTK owns the surface and x11 and
    // wayland behave identically - the reason gstreamer won over libmpv, whose
    // `--wid` embedding is x11-only.
    let sink = gst::ElementFactory::make("gtksink")
        .build()
        .map_err(|_| "gtksink is unavailable (install gstreamer1.0-plugins-good)".to_string())?;
    let video_widget: gtk::Widget = sink.property("widget");

    let play = Play::new(None::<PlayVideoRenderer>);
    // attach our sink to the underlying pipeline. PlayVideoOverlayVideoRenderer
    // is the documented route but is built around GstVideoOverlay, which
    // gtksink does not implement.
    play.pipeline().set_property("video-sink", &sink);

    let window = gtk::Window::new(gtk::WindowType::Toplevel);
    window.set_default_size(960, 540);
    window.set_title("video");

    let chrome = build_chrome(app);
    let (overlay, fullscreen_controls) = build_video_area(app, &video_widget);

    let vbox = gtk::Box::new(gtk::Orientation::Vertical, 0);
    vbox.pack_start(&chrome, false, false, 0);
    vbox.pack_start(&overlay, true, true, 0);
    window.add(&vbox);

    // closing via the window manager must tell the webview, so the playerbar
    // doesn't keep showing a playing item.
    let app_for_delete = app.clone();
    window.connect_delete_event(move |_, _| {
        WINDOW.with(|cell| {
            if let Some(w) = cell.borrow_mut().take() {
                w.play.stop();
            }
        });
        emit_event(&app_for_delete, &VideoEvent::Closed);
        glib::Propagation::Proceed
    });

    connect_play_signals(app, &play);

    Ok(VideoWindow {
        play,
        window,
        chrome: chrome.upcast(),
        fullscreen_controls,
        state: PlayerState::default(),
    })
}

/// title strip with a close button. plain gtk for now - reusing spume's html
/// titlebar would mean packing a thin webview here instead, which is possible
/// (still a vertical stack, no overlay) but deferred until playback is proven.
fn build_chrome(app: &AppHandle<Wry>) -> gtk::Box {
    let bar = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    bar.set_margin_top(6);
    bar.set_margin_bottom(6);
    bar.set_margin_start(10);
    bar.set_margin_end(10);

    let spacer = gtk::Label::new(None);
    bar.pack_start(&spacer, true, true, 0);

    let close = gtk::Button::with_label("\u{2715}");
    close.set_relief(gtk::ReliefStyle::None);
    let app_for_close = app.clone();
    close.connect_clicked(move |_| {
        close_window();
        emit_event(&app_for_close, &VideoEvent::Closed);
    });
    bar.pack_end(&close, false, false, 0);
    bar
}

/// video widget plus the fullscreen-only control bar layered over it. GTK
/// widgets composite over a video widget fine; it is *webview* transparency
/// over video that does not work, which is why this window is not a webview.
fn build_video_area(app: &AppHandle<Wry>, video: &gtk::Widget) -> (gtk::Overlay, gtk::Widget) {
    let overlay = gtk::Overlay::new();
    overlay.add(video);

    let controls = gtk::Box::new(gtk::Orientation::Horizontal, 12);
    controls.set_halign(gtk::Align::Center);
    controls.set_valign(gtk::Align::End);
    controls.set_margin_bottom(24);

    let play_pause = gtk::Button::with_label("\u{25B6}\u{2016}");
    let app_for_toggle = app.clone();
    play_pause.connect_clicked(move |_| {
        let _ = handle_on_main(&app_for_toggle, VideoCommand::TogglePlay);
    });
    controls.pack_start(&play_pause, false, false, 0);

    let exit_fs = gtk::Button::with_label("exit fullscreen");
    let app_for_exit = app.clone();
    exit_fs.connect_clicked(move |_| {
        let _ = handle_on_main(
            &app_for_exit,
            VideoCommand::SetFullscreen { fullscreen: false },
        );
    });
    controls.pack_start(&exit_fs, false, false, 0);

    overlay.add_overlay(&controls);

    // click toggles play/pause, double click toggles fullscreen. the event box
    // is needed because a video widget does not receive button events itself.
    let events = gtk::EventBox::new();
    events.set_above_child(false);
    events.add_events(gdk::EventMask::BUTTON_PRESS_MASK);
    let app_for_click = app.clone();
    events.connect_button_press_event(move |_, ev| {
        match ev.event_type() {
            gdk::EventType::DoubleButtonPress => {
                let _ = handle_on_main(&app_for_click, VideoCommand::ToggleFullscreen);
            }
            gdk::EventType::ButtonPress => {
                let _ = handle_on_main(&app_for_click, VideoCommand::TogglePlay);
            }
            _ => {}
        }
        glib::Propagation::Proceed
    });
    overlay.add_overlay(&events);

    (overlay, controls.upcast())
}

/// translate GstPlay signals into `VideoEvent`s. GstPlay already owns bus
/// watching, position timers, seek flags and async state transitions - the main
/// reason this module is as small as it is.
fn connect_play_signals(app: &AppHandle<Wry>, play: &Play) {
    let adapter = PlaySignalAdapter::new_sync_emit(play);

    let a = app.clone();
    adapter.connect_position_updated(move |_, pos| {
        if let Some(pos) = pos {
            emit_state(
                &a,
                VideoEvent::Position {
                    seconds: pos.seconds_f64(),
                },
            );
        }
    });

    let a = app.clone();
    adapter.connect_duration_changed(move |_, dur| {
        if let Some(dur) = dur {
            emit_state(
                &a,
                VideoEvent::Duration {
                    seconds: dur.seconds_f64(),
                },
            );
        }
    });

    let a = app.clone();
    adapter.connect_state_changed(move |_, state| match state {
        PlayState::Playing => emit_state(&a, VideoEvent::Playing),
        PlayState::Paused => emit_state(&a, VideoEvent::Paused),
        _ => {}
    });

    let a = app.clone();
    adapter.connect_end_of_stream(move |_| emit_state(&a, VideoEvent::Ended));

    let a = app.clone();
    adapter.connect_error(move |_, err, _details| {
        let message = err.to_string();
        emit_state(
            &a,
            VideoEvent::Error {
                error_type: classify_error(&message).to_string(),
                message,
            },
        );
    });

    let a = app.clone();
    adapter.connect_warning(move |_, err, _details| {
        // missing decoders arrive as warnings before the pipeline errors out;
        // surfacing them is what lets the wizard name the package to install.
        let message = err.to_string();
        if classify_error(&message) == "missing_plugin" {
            emit_state(
                &a,
                VideoEvent::Error {
                    error_type: "missing_plugin".to_string(),
                    message,
                },
            );
        }
    });
}

/// fold into local state and only emit when something actually changed, so a
/// 1Hz position tick doesn't spam the webview with redundant updates.
fn emit_state(app: &AppHandle<Wry>, event: VideoEvent) {
    let changed = WINDOW.with(|cell| match cell.borrow_mut().as_mut() {
        Some(w) => w.state.apply(&event),
        // events can arrive after the window is gone; forward them so the
        // webview still sees a terminal state
        None => true,
    });
    if changed {
        emit_event(app, &event);
    }
}
