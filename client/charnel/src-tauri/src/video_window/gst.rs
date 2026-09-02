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
use std::rc::Rc;

use gstreamer as gst;
use gstreamer_play::{Play, PlaySignalAdapter, PlayState, PlayVideoRenderer};
// gdk/glib come from gtk's re-exports so their versions can never drift from
// gtk's own. importing only gtk's prelude also avoids the ambiguous `Cast`
// that comes from having both gst's and gtk's preludes in scope.
use gtk::prelude::*;
use gtk::{gdk, glib};
use tauri::{AppHandle, Wry};

use super::backend::{classify_error, PlayerState, VideoCommand, VideoEvent};
use super::{emit_event, VideoWindowDiagnostics};

thread_local! {
    /// the single live video window, if any. main-thread only.
    static WINDOW: RefCell<Option<VideoWindow>> = const { RefCell::new(None) };
}

struct VideoWindow {
    play: Play,
    /// dropping the adapter disconnects its signal forwarding, so it must live
    /// exactly as long as the window rather than as a local setup variable.
    _signals: PlaySignalAdapter,
    window: gtk::Window,
    /// hover-only close button retained for the undecorated window's lifetime
    _close_button: Option<gtk::Widget>,
    /// centered play/pause icon, flashed briefly on every toggle so a single
    /// click gives clear feedback about the resulting state.
    flash_icon: gtk::Image,
    /// pending fade-out tick for `flash_icon`; re-armed on every flash.
    flash_timer: Rc<RefCell<Option<glib::SourceId>>>,
    state: PlayerState,
}

/// validate the GStreamer runtime without creating a window or loading media.
pub fn diagnostics() -> VideoWindowDiagnostics {
    match gst::init() {
        Ok(()) => {
            let (major, minor, micro, nano) = gst::version();
            VideoWindowDiagnostics {
                available: true,
                gstreamer_version: Some(format!("{major}.{minor}.{micro}.{nano}")),
                playbin3_available: gst::ElementFactory::find("playbin3").is_some(),
                gtksink_available: gst::ElementFactory::find("gtksink").is_some(),
                gtkglsink_available: gst::ElementFactory::find("gtkglsink").is_some(),
                error: None,
            }
        }
        Err(e) => VideoWindowDiagnostics {
            available: false,
            gstreamer_version: None,
            playbin3_available: false,
            gtksink_available: false,
            gtkglsink_available: false,
            error: Some(e.to_string()),
        },
    }
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
        // Stop/teardown races are normal when a video ends or its window was
        // closed by the user. Closing a missing window is therefore a no-op,
        // not a playback failure that should light up the playerbar.
        VideoCommand::Close => {
            close_window();
            Ok(())
        }
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
        VideoCommand::Play => {
            w.play.play();
            flash_icon(w, "media-playback-start-symbolic");
        }
        VideoCommand::Pause => {
            w.play.pause();
            flash_icon(w, "media-playback-pause-symbolic");
        }
        VideoCommand::Seek { seconds } => w
            .play
            .seek(gst::ClockTime::from_mseconds((seconds * 1000.0) as u64)),
        VideoCommand::SetVolume { volume } => w.play.set_volume(*volume),
        VideoCommand::SetFullscreen { fullscreen } => set_fullscreen(w, *fullscreen),
        VideoCommand::Close => {}
        // Load is handled before this point; toggles are resolved by the caller
        VideoCommand::Load { .. } | VideoCommand::TogglePlay | VideoCommand::ToggleFullscreen => {}
    }
    Ok(())
}

fn set_fullscreen(w: &mut VideoWindow, fullscreen: bool) {
    if fullscreen {
        w.window.fullscreen();
    } else {
        w.window.unfullscreen();
    }
}

/// show the centered play/pause icon at full opacity, hold briefly, then
/// step its opacity down to nothing over a handful of ticks. cancels any
/// fade already in progress so rapid toggles don't stack timers.
fn flash_icon(w: &VideoWindow, icon_name: &str) {
    if let Some(id) = w.flash_timer.borrow_mut().take() {
        id.remove();
    }
    w.flash_icon
        .set_from_icon_name(Some(icon_name), gtk::IconSize::Dialog);
    w.flash_icon.set_opacity(1.0);
    w.flash_icon.set_visible(true);

    // ~40 ticks * 40ms: ~1.2s held at full opacity, then fades over the
    // last 10 ticks (~400ms), then hides.
    const HOLD_AND_FADE_TICKS: u32 = 40;
    const FADE_TICKS: u32 = 10;
    let remaining = Rc::new(std::cell::Cell::new(HOLD_AND_FADE_TICKS));
    let image = w.flash_icon.clone();
    let timer_ref = w.flash_timer.clone();
    let id = glib::timeout_add_local(std::time::Duration::from_millis(40), move || {
        let ticks_left = remaining.get();
        if ticks_left == 0 {
            image.set_visible(false);
            *timer_ref.borrow_mut() = None;
            return glib::ControlFlow::Break;
        }
        if ticks_left <= FADE_TICKS {
            image.set_opacity(ticks_left as f64 / FADE_TICKS as f64);
        }
        remaining.set(ticks_left - 1);
        glib::ControlFlow::Continue
    });
    *w.flash_timer.borrow_mut() = Some(id);
}

fn close_window() {
    // take the window out of the cell *before* calling `window.close()`.
    // gtk's `Window::close()` synchronously fires "delete-event" on the same
    // call stack, and that handler also does `cell.borrow_mut().take()` - if
    // this function still held its own `borrow_mut()` across the call (the
    // previous version matched on `cell.borrow_mut().as_mut()` and kept that
    // borrow alive through `w.window.close()`), the reentrant borrow panics
    // the gtk main thread. that's almost certainly why the in-window close
    // button silently "didn't work" (really: panicked/hung the main loop)
    // and is a strong suspect for the "app not responsive" popups when the
    // queue is cleared while a video is playing (which also routes through
    // this same close path).
    let mut taken = WINDOW.with(|cell| cell.borrow_mut().take());
    if let Some(w) = taken.as_mut() {
        if w.state.fullscreen {
            w.window.unfullscreen();
        }
        w.play.stop();
    }
    if let Some(w) = taken {
        w.window.close();
    }
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
    let uri = glib::filename_to_uri(path, None).map_err(|e| {
        tracing::warn!(path = %path, error = %e, "video_window: bad path passed to load");
        format!("bad video path {path}: {e}")
    })?;
    tracing::info!(path = %path, title = ?title, "video_window: loading");

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

    // With chromeless off, GTK's own title bar remains movable, resizable and
    // closeable. With it on, the video itself supplies drag handling and a
    // hover-only close button, leaving the picture unobstructed at rest.
    let chromeless = crate::app_config::FreqholeAppConfig::load(app)
        .map(|config| config.chromeless_title_bar)
        .unwrap_or_else(crate::app_config::default_chromeless_title_bar);
    window.set_decorated(!chromeless);

    let (overlay, close_button, flash_icon) =
        build_video_area(app, &window, &video_widget, chromeless);
    window.add(&overlay);

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

    let signals = connect_play_signals(app, &play);

    Ok(VideoWindow {
        play,
        _signals: signals,
        window,
        _close_button: close_button,
        flash_icon,
        flash_timer: Rc::new(RefCell::new(None)),
        state: PlayerState::default(),
    })
}

/// video widget plus a transparent click surface. fullscreen controls are
/// intentionally omitted for now: the prior static bar never hid and captured
/// pointer input. the main playerbar remains the fullscreen control surface.
fn build_video_area(
    app: &AppHandle<Wry>,
    window: &gtk::Window,
    video: &gtk::Widget,
    chromeless: bool,
) -> (gtk::Overlay, Option<gtk::Widget>, gtk::Image) {
    let overlay = gtk::Overlay::new();
    overlay.add(video);

    // A video widget does not receive button events itself. Stationary clicks
    // toggle playback; once the pointer crosses this threshold the same press
    // becomes a standard GTK window drag instead.
    let events = gtk::EventBox::new();
    events.set_above_child(true);
    events.add_events(
        gdk::EventMask::BUTTON_PRESS_MASK
            | gdk::EventMask::BUTTON_RELEASE_MASK
            | gdk::EventMask::POINTER_MOTION_MASK
            | gdk::EventMask::ENTER_NOTIFY_MASK
            | gdk::EventMask::LEAVE_NOTIFY_MASK
            | gdk::EventMask::KEY_PRESS_MASK,
    );
    let press = Rc::new(RefCell::new(None::<(f64, f64, u32)>));
    let press_for_down = press.clone();
    let app_for_click = app.clone();
    events.connect_button_press_event(move |_, ev| {
        if ev.button() != 1 {
            return glib::Propagation::Proceed;
        }
        match ev.event_type() {
            gdk::EventType::DoubleButtonPress => {
                *press_for_down.borrow_mut() = None;
                let _ = handle_on_main(&app_for_click, VideoCommand::ToggleFullscreen);
            }
            gdk::EventType::ButtonPress => {
                let (x, y) = ev.root();
                *press_for_down.borrow_mut() = Some((x, y, ev.time()));
            }
            _ => {}
        }
        glib::Propagation::Proceed
    });
    let press_for_motion = press.clone();
    let window_for_drag = window.clone();
    events.connect_motion_notify_event(move |_, ev| {
        let Some((start_x, start_y, time)) = *press_for_motion.borrow() else {
            return glib::Propagation::Proceed;
        };
        let (x, y) = ev.root();
        if (x - start_x).abs() >= 4.0 || (y - start_y).abs() >= 4.0 {
            *press_for_motion.borrow_mut() = None;
            window_for_drag.begin_move_drag(1, x as i32, y as i32, time);
        }
        glib::Propagation::Proceed
    });
    let press_for_up = press.clone();
    let app_for_release = app.clone();
    events.connect_button_release_event(move |_, ev| {
        if ev.button() == 1 && press_for_up.borrow_mut().take().is_some() {
            let _ = handle_on_main(&app_for_release, VideoCommand::TogglePlay);
        }
        glib::Propagation::Proceed
    });
    let app_for_keys = app.clone();
    // key events go to whichever widget has gtk keyboard focus, and the
    // `EventBox` used for click/drag handling is not focusable by default -
    // so a `connect_key_press_event` on it never actually fired (this is
    // almost certainly why space/escape "didn't work"). the toplevel window
    // always receives key events for anything not consumed by a focused
    // child, so bind here instead.
    window.connect_key_press_event(move |_, ev| match ev.keyval().name().as_deref() {
        Some("space") => {
            let _ = handle_on_main(&app_for_keys, VideoCommand::TogglePlay);
            glib::Propagation::Stop
        }
        Some("Escape") => {
            let _ = handle_on_main(&app_for_keys, VideoCommand::Close);
            glib::Propagation::Stop
        }
        _ => glib::Propagation::Proceed,
    });
    overlay.add_overlay(&events);

    // centered play/pause indicator, flashed on every toggle (see
    // `flash_icon()`). starts hidden; never intercepts input - GtkOverlay
    // children capture input for their whole allocation by default (this is
    // also what caused the close-button ping-pong below), and without
    // `pass_through` this icon would swallow clicks/motion landing on it
    // for the length of every fade, which is most of dead-center of the
    // video - exactly where a user naturally clicks to pause. that read as
    // "the play icon gets stuck and there's no mouse interaction", and as
    // "toggle never reaches paused" (the very click meant to pause never
    // reached `events` underneath).
    let flash_icon =
        gtk::Image::from_icon_name(Some("media-playback-start-symbolic"), gtk::IconSize::Dialog);
    flash_icon.set_halign(gtk::Align::Center);
    flash_icon.set_valign(gtk::Align::Center);
    flash_icon.set_pixel_size(96);
    flash_icon.set_opacity(0.0);
    flash_icon.set_visible(false);
    overlay.add_overlay(&flash_icon);
    overlay.set_overlay_pass_through(&flash_icon, true);
    tint_magenta(&flash_icon);

    if !chromeless {
        return (overlay, None, flash_icon);
    }

    // gtk::Window has no `is_fullscreen()` query in this gtk-rs version, so
    // track it ourselves off window-state-event.
    let is_fullscreen = Rc::new(std::cell::Cell::new(false));

    let close = gtk::Button::with_label("\u{2715}");
    close.set_relief(gtk::ReliefStyle::None);
    close.set_halign(gtk::Align::End);
    close.set_valign(gtk::Align::Start);
    close.set_margin_top(12);
    close.set_margin_end(12);
    close.set_tooltip_text(Some("close video"));
    close.connect_clicked(move |_| close_window());
    close.hide();
    tint_magenta(&close);
    overlay.add_overlay(&close);

    let fullscreen_btn = gtk::Button::new();
    fullscreen_btn.set_image(Some(&gtk::Image::from_icon_name(
        Some("view-fullscreen-symbolic"),
        gtk::IconSize::Button,
    )));
    fullscreen_btn.set_relief(gtk::ReliefStyle::None);
    fullscreen_btn.set_halign(gtk::Align::End);
    fullscreen_btn.set_valign(gtk::Align::Start);
    fullscreen_btn.set_margin_top(12);
    // sits just to the left of the close button.
    fullscreen_btn.set_margin_end(44);
    fullscreen_btn.set_tooltip_text(Some("enter fullscreen"));
    let app_for_fullscreen_btn = app.clone();
    fullscreen_btn.connect_clicked(move |_| {
        let _ = handle_on_main(&app_for_fullscreen_btn, VideoCommand::ToggleFullscreen);
    });
    fullscreen_btn.hide();
    tint_magenta(&fullscreen_btn);
    overlay.add_overlay(&fullscreen_btn);

    // only visible while windowed - once fullscreen there's nothing left to
    // toggle it *to* from this button (escape/click-video/space still work).
    let fullscreen_btn_for_state = fullscreen_btn.clone();
    let is_fullscreen_for_state = is_fullscreen.clone();
    window.connect_window_state_event(move |_, ev| {
        let now_fullscreen = ev.new_window_state().contains(gdk::WindowState::FULLSCREEN);
        is_fullscreen_for_state.set(now_fullscreen);
        if now_fullscreen {
            fullscreen_btn_for_state.hide();
        }
        glib::Propagation::Proceed
    });

    // undecorated windows lose the window manager's resize border, so drag
    // the corner ourselves - a small hover-visible grip where the window
    // manager would otherwise put one.
    let resize_grip = gtk::EventBox::new();
    resize_grip.set_halign(gtk::Align::End);
    resize_grip.set_valign(gtk::Align::End);
    resize_grip.set_size_request(18, 18);
    resize_grip.add_events(gdk::EventMask::BUTTON_PRESS_MASK | gdk::EventMask::ENTER_NOTIFY_MASK);
    let grip_label = gtk::Label::new(Some("\u{2571}\u{2571}"));
    tint_magenta(&grip_label);
    resize_grip.add(&grip_label);
    resize_grip.hide();
    let window_for_resize = window.clone();
    resize_grip.connect_button_press_event(move |_, ev| {
        if ev.button() == 1 {
            let (x, y) = ev.root();
            window_for_resize.begin_resize_drag(
                gdk::WindowEdge::SouthEast,
                1,
                x as i32,
                y as i32,
                ev.time(),
            );
        }
        glib::Propagation::Stop
    });
    overlay.add_overlay(&resize_grip);

    // one shared hover/inactivity timer for every chromeless overlay
    // control (close, fullscreen toggle, resize grip): show + reset on any
    // hover/motion, hide everything after 1.8s of none. a single group
    // avoids each control fighting the others' enter/leave events (see the
    // comment below on why leave-notify-driven hiding was removed).
    let controls_timeout: Rc<RefCell<Option<glib::SourceId>>> = Rc::new(RefCell::new(None));
    let close_for_timer = close.clone();
    let fullscreen_btn_for_timer = fullscreen_btn.clone();
    let resize_grip_for_timer = resize_grip.clone();
    let is_fullscreen_for_timer = is_fullscreen.clone();
    let timeout_ref = controls_timeout.clone();
    let reset_controls_timer = move || {
        if let Some(id) = timeout_ref.borrow_mut().take() {
            id.remove();
        }
        let close_clone = close_for_timer.clone();
        let fullscreen_btn_clone = fullscreen_btn_for_timer.clone();
        let resize_grip_clone = resize_grip_for_timer.clone();
        let timer_ref = timeout_ref.clone();
        let id = glib::timeout_add_local(std::time::Duration::from_millis(1800), move || {
            close_clone.hide();
            fullscreen_btn_clone.hide();
            resize_grip_clone.hide();
            *timer_ref.borrow_mut() = None;
            glib::ControlFlow::Break
        });
        *timeout_ref.borrow_mut() = Some(id);
    };
    let show_controls = {
        let close = close.clone();
        let fullscreen_btn = fullscreen_btn.clone();
        let resize_grip = resize_grip.clone();
        let is_fullscreen = is_fullscreen_for_timer.clone();
        let reset = reset_controls_timer.clone();
        move || {
            close.show();
            if !is_fullscreen.get() {
                fullscreen_btn.show();
            }
            resize_grip.show();
            reset();
        }
    };

    // show-on-hover only; hiding is driven solely by `reset_controls_timer`'s
    // inactivity timeout above. a paired leave-notify "hide" handler here
    // (and on `close` itself) used to fight the button's own enter-notify:
    // moving onto an overlapping control widget fires a leave-notify on
    // `events` first, hiding it an instant before its own enter-notify
    // re-showed it, which read as a hover/click glitch-flash and could eat
    // clicks landing during the hidden instant.
    let show_for_events_enter = show_controls.clone();
    events.connect_enter_notify_event(move |_, _| {
        show_for_events_enter();
        glib::Propagation::Proceed
    });
    let show_for_close_enter = show_controls.clone();
    close.connect_enter_notify_event(move |_, _| {
        show_for_close_enter();
        glib::Propagation::Proceed
    });
    let show_for_fullscreen_enter = show_controls.clone();
    fullscreen_btn.connect_enter_notify_event(move |_, _| {
        show_for_fullscreen_enter();
        glib::Propagation::Proceed
    });
    let show_for_grip_enter = show_controls.clone();
    resize_grip.connect_enter_notify_event(move |_, _| {
        show_for_grip_enter();
        glib::Propagation::Proceed
    });
    let show_for_motion = show_controls.clone();
    events.connect_motion_notify_event(move |_, _| {
        if is_fullscreen.get() {
            show_for_motion();
        }
        glib::Propagation::Proceed
    });

    (overlay, Some(close.upcast()), flash_icon)
}

/// apply the video window's magenta accent to a control widget's own color
/// (and, since gtk css `color` inherits, to any of its child widgets too -
/// e.g. a `gtk::Button`'s internal label).
fn tint_magenta(widget: &impl IsA<gtk::Widget>) {
    let css = gtk::CssProvider::new();
    if css.load_from_data(b"* { color: #ff2fd0; }").is_ok() {
        widget
            .style_context()
            .add_provider(&css, gtk::STYLE_PROVIDER_PRIORITY_APPLICATION);
    }
}

/// translate GstPlay signals into `VideoEvent`s. GstPlay already owns bus
/// watching, position timers, seek flags and async state transitions - the main
/// reason this module is as small as it is.
fn connect_play_signals(app: &AppHandle<Wry>, play: &Play) -> PlaySignalAdapter {
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

    adapter
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
