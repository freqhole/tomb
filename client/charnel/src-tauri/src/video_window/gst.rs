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
// single targeted trait imports (not the full gst::prelude::*) so this
// doesn't reintroduce the ambiguous-Cast collision with gtk's own prelude
// noted below. DeviceExt backs the device-picker enumeration in
// `list_audio_sink_devices`/`make_audio_sink`; DeviceProviderExt/
// DeviceProviderExtManual back querying a single named provider (pipewire/
// pulse) directly instead of every registered provider.
use gstreamer::prelude::{
    DeviceExt as _, DeviceProviderExt as _, DeviceProviderExtManual as _, ElementExt as _,
    GstBinExt as _, GstObjectExt as _,
};
use gstreamer_play::{Play, PlaySignalAdapter, PlayState, PlayVideoRenderer};
// gdk/glib come from gtk's re-exports so their versions can never drift from
// gtk's own. importing only gtk's prelude also avoids the ambiguous `Cast`
// that comes from having both gst's and gtk's preludes in scope.
use gtk::prelude::*;
use gtk::{gdk, glib};
use tauri::{AppHandle, Wry};

use super::backend::{
    classify_error, fit_initial_window, AudioDeviceInfo, PlayerState, VideoCommand, VideoEvent,
};
use super::{emit_event, VideoWindowDiagnostics};

thread_local! {
    /// the single live video window, if any. main-thread only.
    static WINDOW: RefCell<Option<VideoWindow>> = const { RefCell::new(None) };
    /// the user's last explicit fullscreen/windowed choice, remembered
    /// across video loads (including a brand new window after the
    /// previous one closed) - defaults to fullscreen. updated by every
    /// `set_fullscreen` call, so the next video always starts however the
    /// user last left it rather than always resetting to windowed.
    static DEFAULT_FULLSCREEN: std::cell::Cell<bool> = const { std::cell::Cell::new(true) };
    /// the user's last explicitly-chosen audio sink device (its
    /// `gst::Device::display_name()`, looked up again in
    /// `LAST_DEVICE_LIST` when actually building a sink), or `None` for the
    /// pipewiresink/autoaudiosink default in `make_audio_sink`. remembered
    /// across loads and window recreation, same convention as
    /// `DEFAULT_FULLSCREEN`.
    static SELECTED_AUDIO_DEVICE: RefCell<Option<String>> = const { RefCell::new(None) };
    /// snapshot from the most recent `list_audio_sink_devices()` call -
    /// `gst::Device` has no separate stable string id of its own (unlike
    /// cpal's `DeviceId`), so a selection is resolved back to a real device
    /// by re-checking this cache rather than re-querying the monitor (the
    /// picker only ever lets the user choose from what it just listed, so
    /// the cache is always fresh enough for that one round trip).
    static LAST_DEVICE_LIST: RefCell<Vec<gst::Device>> = const { RefCell::new(Vec::new()) };
}

struct VideoWindow {
    play: Play,
    /// dropping the adapter disconnects its signal forwarding, so it must live
    /// exactly as long as the window rather than as a local setup variable.
    _signals: PlaySignalAdapter,
    window: gtk::Window,
    /// hover-only controls retained for the undecorated window's lifetime
    overlay_controls: Vec<gtk::Widget>,
    /// only the first decoded video sizes a newly-created window; later loads
    /// preserve whatever size and position the user chose.
    sized_to_video: bool,
    /// centered play/pause icon, flashed briefly on every toggle so a single
    /// click gives clear feedback about the resulting state.
    flash_icon: gtk::Image,
    /// pending fade-out tick for `flash_icon`; re-armed on every flash.
    flash_timer: Rc<RefCell<Option<glib::SourceId>>>,
    state: PlayerState,
}

/// every audio sink element factory actually registered on this system,
/// e.g. `pipewiresink`/`pulsesink`/`alsasink`/`jackaudiosink` - whichever
/// of those (or others) this system's GStreamer install actually has.
/// `factories_with_type` (unlike `ElementFactory::find`, which only checks
/// one name at a time) enumerates every registered plugin matching a
/// type/rank filter, so this needs no hardcoded candidate-name list.
/// `Rank::None` includes even zero-ranked/never-autoplugged factories -
/// deliberately permissive here since this list exists for a human to
/// pick a name for `[video].linux_audio_sink`, not for autoplugging.
fn list_audio_sink_factory_names() -> Vec<String> {
    let mut names: Vec<String> = gst::ElementFactory::factories_with_type(
        gst::ElementFactoryType::MEDIA_AUDIO | gst::ElementFactoryType::SINK,
        gst::Rank::None,
    )
    .into_iter()
    .map(|f| f.name().to_string())
    .collect();
    names.sort();
    names
}

/// validate the GStreamer runtime without creating a window or loading media.
pub fn diagnostics() -> VideoWindowDiagnostics {
    match gst::init() {
        Ok(()) => {
            let (major, minor, micro, nano) = gst::version();
            let available_audio_sinks = list_audio_sink_factory_names();
            tracing::info!(
                ?available_audio_sinks,
                "video_window: available audio sink factories"
            );
            VideoWindowDiagnostics {
                available: true,
                gstreamer_version: Some(format!("{major}.{minor}.{micro}.{nano}")),
                playbin3_available: gst::ElementFactory::find("playbin3").is_some(),
                gtksink_available: gst::ElementFactory::find("gtksink").is_some(),
                gtkglsink_available: gst::ElementFactory::find("gtkglsink").is_some(),
                error: None,
                available_audio_sinks,
            }
        }
        Err(e) => VideoWindowDiagnostics {
            available: false,
            gstreamer_version: None,
            playbin3_available: false,
            gtksink_available: false,
            gtkglsink_available: false,
            error: Some(e.to_string()),
            available_audio_sinks: Vec::new(),
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
        // no window needed to enumerate - lets the picker query devices
        // before any video has ever been loaded. runs on a plain thread
        // (not the gtk main thread `dispatch()` otherwise marshals onto) -
        // a device provider's `start()` does a real round-trip to its
        // sound server, and that round trip stalling for even a few
        // seconds (observed live, alongside a `gst_alsa_device_new:
        // assertion 'caps' failed` GLib critical from the raw ALSA
        // provider fighting PipeWire for the same hardware) previously
        // froze the entire app, not just the video window, since the gtk
        // main thread IS the whole app's UI thread under tauri.
        VideoCommand::ListOutputDevices => {
            let app_for_thread = app.clone();
            std::thread::spawn(move || {
                let (devices, cached) = list_audio_sink_devices();
                let app_for_main = app_for_thread.clone();
                let _ = app_for_thread.run_on_main_thread(move || {
                    LAST_DEVICE_LIST.with(|cell| *cell.borrow_mut() = cached);
                    emit_event(&app_for_main, &VideoEvent::OutputDevices { devices });
                });
            });
            Ok(())
        }
        VideoCommand::SetOutputDevice { name } => set_output_device(app, name),
        other => with_window(|w| {
            // resolve toggles against real state before touching the pipeline
            let resolved = match other {
                VideoCommand::TogglePlay => w.state.resolve_toggle(),
                VideoCommand::ToggleFullscreen => VideoCommand::SetFullscreen {
                    fullscreen: !w.state.fullscreen,
                },
                c => c,
            };
            tracing::info!(
                before_state = ?w.state.state,
                ?resolved,
                "video_window: handle_on_main resolved command"
            );
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
        // Load/device commands are handled before this point; toggles are
        // resolved by the caller.
        VideoCommand::Load { .. }
        | VideoCommand::TogglePlay
        | VideoCommand::ToggleFullscreen
        | VideoCommand::ListOutputDevices
        | VideoCommand::SetOutputDevice { .. } => {}
    }
    Ok(())
}

fn set_fullscreen(w: &mut VideoWindow, fullscreen: bool) {
    if fullscreen {
        w.window.fullscreen();
    } else {
        w.window.unfullscreen();
    }
    DEFAULT_FULLSCREEN.with(|c| c.set(fullscreen));
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
        // `apply_command`'s Load arm resets `fullscreen` to `false` via its
        // own `..PlayerState::default()` spread - reapply the user's
        // remembered choice after that reset, or every load would silently
        // drop back to windowed regardless of what the user last chose.
        // the actual `w.window.fullscreen()` call is deferred until after
        // `show_all()`/`present()` below: on a brand-new, not-yet-mapped
        // window (first launch only - a reused window is already mapped
        // from its previous load) some window managers silently ignore a
        // fullscreen request made before the window is shown.
        let fullscreen = DEFAULT_FULLSCREEN.with(|c| c.get());
        w.state.fullscreen = fullscreen;
        w.window.set_title(title.unwrap_or("video"));
        // re-applied on every load (not just window creation) so a device
        // chosen mid-session survives onto whatever plays next.
        let device = SELECTED_AUDIO_DEVICE.with(|c| c.borrow().clone());
        apply_audio_sink(&w.play, device.as_deref())?;
        w.play.set_uri(Some(uri.as_str()));
        w.play.play();
        if let Some(start) = start_seconds.filter(|s| *s > 0.0) {
            w.play
                .seek(gst::ClockTime::from_mseconds((start * 1000.0) as u64));
        }
        w.window.show_all();
        for control in &w.overlay_controls {
            control.hide();
        }
        w.window.present();
        set_fullscreen(w, fullscreen);
        // present() *asks* the window manager for input focus but some
        // wms/compositors ignore or delay that - grab_focus() is a second,
        // more direct request GTK makes of itself. logged so a future "space
        // bar does nothing" report can be correlated against whether the
        // window ever actually reports having focus (see connect_focus_in/
        // out_event below).
        w.window.grab_focus();
        tracing::info!("video_window: present() + grab_focus() called after load");
        Ok(())
    })
}

/// switch the audio sink and, if a video is already loaded, reload it at the
/// same position so the new device takes effect immediately - `audio-sink`
/// is only honored by playbin3 while (re)configuring for a uri, there's no
/// live hot-swap while PLAYING.
fn set_output_device(app: &AppHandle<Wry>, name: String) -> Result<(), String> {
    tracing::info!(device = %name, "video_window: set_output_device");
    SELECTED_AUDIO_DEVICE.with(|c| *c.borrow_mut() = Some(name));
    let reload = WINDOW.with(|cell| {
        cell.borrow().as_ref().and_then(|w| {
            w.state
                .path
                .clone()
                .map(|path| (path, w.state.title.clone(), w.state.position))
        })
    });
    match reload {
        Some((path, title, position)) => {
            open_or_reuse(app, &path, title.as_deref(), Some(position))
        }
        // nothing loaded yet - the choice is remembered for the next Load.
        None => Ok(()),
    }
}

/// reverted (2026-09-27): tried preferring `gtkglsink` (GL-accelerated
/// compositing via `glsinkbin`) over plain `gtksink` to address video
/// stutter on a raspberry pi - see docs/linux-video-window-plan.md's
/// "start with gtksink, switch if performance demands it" note. NOT
/// actually an improvement in practice: on real pi hardware it produced
/// "No available configurations for the given pixel format" (an EGL/GL
/// config-negotiation failure) for some videos, which also got
/// misclassified by `classify_error()`'s crude substring matching as a
/// misleading "file not found" error (the file was never missing - the
/// GL pipeline just couldn't negotiate a config for that video's pixel
/// format). back to plain gtksink until a real fix (e.g. actually
/// probing available EGL configs before committing to the GL path, or a
/// v4l2-based hardware decoder) is investigated.
fn make_video_sink() -> Result<(gst::Element, gtk::Widget), String> {
    let sink = gst::ElementFactory::make("gtksink")
        .build()
        // gtksink ships in its own package (links GTK3) separately from
        // gst-plugins-good, unlike most "good" elements.
        .map_err(|_| "gtksink is unavailable (install gstreamer1.0-gtk3)".to_string())?;
    let widget: gtk::Widget = sink.property("widget");
    Ok((sink, widget))
}

/// enumerate the audio sinks GStreamer itself knows about, querying a
/// single named device provider directly (pipewire, falling back to pulse)
/// rather than the generic multi-provider `DeviceMonitor` - the monitor
/// fans out to every registered provider matching the class filter,
/// including GStreamer's own raw ALSA provider, which tries to open/probe
/// the same hardware nodes PipeWire already holds open exclusively. that
/// combination produced a `gst_alsa_device_new: assertion 'caps' failed`
/// GLib critical plus a multi-second stall observed live on the Pi -
/// querying only the sound-server-aware provider we actually want avoids
/// the raw ALSA provider entirely. returns the display list alongside the
/// raw `gst::Device`s so the caller (which runs this off the main thread -
/// see `VideoCommand::ListOutputDevices`) can populate the main-thread-only
/// `LAST_DEVICE_LIST` cache itself after hopping back.
fn list_audio_sink_devices() -> (Vec<AudioDeviceInfo>, Vec<gst::Device>) {
    for provider_name in ["pipewiredeviceprovider", "pulsedeviceprovider"] {
        let Some(provider) = gst::DeviceProviderFactory::find(provider_name).and_then(|f| f.get())
        else {
            continue;
        };
        if let Err(e) = provider.start() {
            tracing::warn!(
                provider_name,
                error = %e,
                "video_window: device provider failed to start"
            );
            continue;
        }
        let mut cached = Vec::new();
        let mut infos = Vec::new();
        for device in provider.devices() {
            // the provider itself isn't filtered by media class (unlike
            // `DeviceMonitor::add_filter`), so filter here.
            if !device.device_class().contains("Audio/Sink") {
                continue;
            }
            let name = device.display_name().to_string();
            // full properties structure (pipewire's provider populates this
            // with node.name/object.serial/device.api/etc, pulse's
            // similarly) - logged in full since the picker's display names
            // alone often look like duplicates (same human label, different
            // underlying node/profile) with no way to tell them apart
            // otherwise.
            let device_class = device.device_class();
            let properties = device.properties();
            tracing::info!(
                provider_name,
                name,
                device_class = %device_class,
                properties = properties.as_ref().map(ToString::to_string),
                "video_window: audio sink device found"
            );
            infos.push(AudioDeviceInfo {
                name: name.clone(),
                description: name,
            });
            cached.push(device);
        }
        provider.stop();
        tracing::info!(
            provider_name,
            count = infos.len(),
            "video_window: listed audio sink devices"
        );
        return (infos, cached);
    }
    tracing::warn!(
        "video_window: neither pipewire nor pulse device provider is available, no devices listed"
    );
    (Vec::new(), Vec::new())
}

/// build the audio sink for the next Load. `[video].linux_audio_sink`, if
/// set, wins outright - it's a gst-launch-style element description (same
/// syntax as `gst-launch-1.0 ... audio-sink="..."`, e.g. `"pipewiresink
/// sync=false"` or bare `"alsasink"` with no properties), parsed via
/// `gst::parse_launch` - so any property combination already validated by
/// hand on the command line (sync/qos/processing-deadline/slave-method/
/// etc, all real things tried live against pipewiresink stutter on a pi)
/// can be pasted straight into config with no per-property config field
/// needed. `[video].linux_audio_sink_device` additionally sets the
/// resulting element's `device` property if it has one (e.g. a bare
/// `"alsasink"` with `device = "hw:2,0"` to bypass pipewire/pulseaudio
/// entirely) - only takes effect for a single bare element, silently
/// skipped (logged) if the description already produced a multi-element
/// bin without its own top-level `device` property. an escape hatch for
/// debugging/comparing sinks, or for a user to pin whatever actually
/// behaves well on their own hardware. falls through to the normal logic
/// below if the description fails to parse (typo, or a named element
/// that's genuinely not installed).
///
/// absent that override, an explicit `device` (a `gst::Device::
/// display_name()` from the most recent `list_audio_sink_devices()` call)
/// is looked up in `LAST_DEVICE_LIST` and turned into a sink via
/// `Device::create_element` - that already returns a correctly-targeted
/// sink regardless of which provider (pipewire/alsa/pulse) the device came
/// from, so there's no manual `target-object`/pcm-id property wrangling
/// here. with no selection (or a stale one), prefer `pipewiresink`
/// outright - it follows whatever PipeWire/WirePlumber currently treats as
/// the default sink, same as the system volume control would - falling
/// back to plain `autoaudiosink` on systems without `gstreamer1.0-pipewire`
/// installed.
fn make_audio_sink(device: Option<&str>) -> Result<gst::Element, String> {
    let video_config = &grimoire::config::get_config().video;
    if let Some(description) = video_config.linux_audio_sink.as_deref() {
        match gst::parse_launch(description) {
            Ok(sink) => {
                if let Some(value) = video_config.linux_audio_sink_device.as_deref() {
                    if sink.has_property("device", None) {
                        sink.set_property("device", value.to_string());
                    } else {
                        tracing::warn!(
                            description,
                            value,
                            "video_window: linux_audio_sink_device set but the forced sink has no `device` property"
                        );
                    }
                }
                tracing::info!(
                    description,
                    "video_window: using configured linux_audio_sink override"
                );
                return Ok(sink);
            }
            Err(e) => tracing::warn!(
                description,
                error = %e,
                "video_window: configured linux_audio_sink failed to parse/build, falling back to normal sink selection"
            ),
        }
    }
    if let Some(name) = device {
        let found = LAST_DEVICE_LIST.with(|cell| {
            cell.borrow()
                .iter()
                .find(|d| d.display_name() == name)
                .cloned()
        });
        match found {
            Some(device) => match device.create_element(None) {
                Ok(sink) => {
                    tracing::info!(name, "video_window: built audio sink for selected device");
                    return Ok(sink);
                }
                Err(e) => tracing::warn!(
                    name,
                    error = %e,
                    "video_window: selected device failed to build a sink, falling back"
                ),
            },
            None => tracing::warn!(
                name,
                "video_window: selected device no longer known, falling back"
            ),
        }
    }
    if let Ok(sink) = gst::ElementFactory::make("pipewiresink").build() {
        tracing::info!("video_window: using pipewiresink (no explicit device selected)");
        return Ok(sink);
    }
    tracing::info!("video_window: pipewiresink unavailable, falling back to autoaudiosink");
    gst::ElementFactory::make("autoaudiosink")
        .build()
        .map_err(|e| format!("autoaudiosink is unavailable: {e}"))
}

fn apply_audio_sink(play: &Play, device: Option<&str>) -> Result<(), String> {
    let sink = make_audio_sink(device)?;
    play.pipeline().set_property("audio-sink", &sink);
    Ok(())
}

fn build_window(app: &AppHandle<Wry>) -> Result<VideoWindow, String> {
    // gtksink/gtkglsink give us a real GTK widget, so GTK owns the surface
    // and x11 and wayland behave identically - the reason gstreamer won
    // over libmpv, whose `--wid` embedding is x11-only.
    let (sink, video_widget) = make_video_sink()?;

    let play = Play::new(None::<PlayVideoRenderer>);
    // attach our sink to the underlying pipeline. PlayVideoOverlayVideoRenderer
    // is the documented route but is built around GstVideoOverlay, which
    // neither gtksink nor gtkglsink implement.
    play.pipeline().set_property("video-sink", &sink);
    apply_audio_buffer_tuning(&play);

    let window = gtk::Window::new(gtk::WindowType::Toplevel);
    window.set_default_size(960, 540);
    window.set_title("video");
    force_black_background(&window);

    // With chromeless off, GTK's own title bar remains movable, resizable and
    // closeable. With it on, the video itself supplies drag handling and a
    // hover-only close button, leaving the picture unobstructed at rest.
    let chromeless = crate::app_config::FreqholeAppConfig::load(app)
        .map(|config| config.chromeless_title_bar)
        .unwrap_or_else(crate::app_config::default_chromeless_title_bar);
    window.set_decorated(!chromeless);

    let (overlay, overlay_controls, flash_icon) =
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

    window.connect_focus_in_event(|_, _| {
        tracing::info!("video_window: window gained keyboard focus");
        glib::Propagation::Proceed
    });
    window.connect_focus_out_event(|_, _| {
        tracing::info!("video_window: window lost keyboard focus (space/escape won't reach it until it's refocused)");
        glib::Propagation::Proceed
    });

    let signals = connect_play_signals(app, &play);

    Ok(VideoWindow {
        play,
        _signals: signals,
        window,
        overlay_controls,
        sized_to_video: false,
        flash_icon,
        flash_timer: Rc::new(RefCell::new(None)),
        state: PlayerState::default(),
    })
}

/// per-element pipeline tuning applied as things are actually constructed:
/// disables QoS-driven buffer drops on the audio sink, bumps decodebin3's
/// internal multiqueue limits, and logs which decoder/sink elements got
/// picked. "deep-element-added" fires for whatever real sink `autoaudiosink`
/// picks internally (pulsesink/pipewiresink/alsasink), not just direct
/// pipeline children, so this catches it regardless of which backend the
/// host actually uses, and fires again on every subsequent `Load` (a fresh
/// audio sink is created per uri), so hooking it once here at window-build
/// time is enough for the window's whole lifetime.
///
/// reverted (2026-09-28): this used to also force a much larger
/// `buffer-time` on the audio sink (`[video].linux_buffer_frames` in
/// config, mirroring `[audio].linux_buffer_frames` for the rodio music
/// backend). removed after field testing on a raspberry pi showed it made
/// no difference to the actual stutter - the buffer was never the
/// bottleneck (see the qos=false comment below for what the real lead
/// turned out to be) - so the config knob was dropped as well.
fn apply_audio_buffer_tuning(play: &Play) {
    let Ok(bin) = play.pipeline().downcast::<gst::Bin>() else {
        return;
    };
    bin.connect_deep_element_added(|_bin, _sub_bin, element| {
        // diagnostic only (no behavior change): logs which decoder element
        // playbin3 actually picked for this video - the most direct way to
        // tell a software decoder (`libav h.264/h.265 decoder`, cpu-bound)
        // from a hardware-accelerated one (klass containing "Hardware")
        // without needing a separate `gst-inspect-1.0` pass on the pi.
        // `klass()`/`longname()` are plain inherent methods on
        // `ElementFactory` (no extra prelude trait needed), unlike
        // `GstObjectExt::name()`'s short registered name.
        if let Some(factory) = element.factory() {
            let klass = factory.klass();
            if klass.contains("Decoder") {
                tracing::info!(
                    klass,
                    longname = factory.longname(),
                    "video_window: decoder element added to pipeline"
                );
            }
            // diagnostic only: `autoaudiosink` picks its real child sink
            // (pulsesink/pipewiresink/alsasink) internally and silently -
            // this is the only place that's ever visible from the app's
            // own logs, and is the first thing to check when suspecting
            // the "auto" choice picked a bad device. `device`/`device-name`
            // are read back (not just requested) since some sinks default
            // to whatever the daemon considers "default" rather than
            // reporting an explicit device string. read as `Option<String>`,
            // not `String` - these are nullable properties that default to
            // unset on plenty of concrete sinks, and pulling a NULL GValue
            // as a non-nullable `String` panics glib's cast (crashed the
            // whole process the one time a sink actually had `device`
            // declared but left at its NULL default).
            if klass.contains("Sink/Audio") {
                let device = element
                    .has_property("device", None)
                    .then(|| element.property::<Option<String>>("device"))
                    .flatten();
                let device_name = element
                    .has_property("device-name", None)
                    .then(|| element.property::<Option<String>>("device-name"))
                    .flatten();
                // GstBaseSink's QoS logic can decide a buffer arrived too
                // late and drop it under borderline scheduling latency
                // rather than there being a real underrun - disabling it
                // was field-tested against real stuttering audio on a pi
                // (confirmed via this very log line firing with qos set)
                // but did NOT fix it, ruling out QoS-driven drops as the
                // cause. left disabled anyway since it's harmless and
                // avoids that failure mode outright if it ever recurs on
                // different hardware.
                if element.has_property("qos", None) {
                    element.set_property("qos", false);
                }
                tracing::info!(
                    klass,
                    longname = factory.longname(),
                    ?device,
                    ?device_name,
                    "video_window: audio sink element added to pipeline"
                );
            }
        }
        // decodebin3's internal multiqueue (sitting between demux and
        // decode) defaults to whichever of 5 buffers / 10MB / 2s hits
        // first (confirmed via gstreamer's own coreelements docs) - 5
        // compressed video buffers is a thin cushion against a bursty
        // demux read (uneven frame sizes, a slow sd card, momentary cpu
        // contention), and sits upstream of decode entirely, so it can
        // starve video AND audio alike. `type_().name()` is a plain glib
        // method (no gst-specific trait needed) - used instead of the
        // factory's klass ("Generic", useless here) to identify this
        // element precisely.
        if element.type_().name() == "GstMultiQueue" {
            const MAX_SIZE_BUFFERS: u32 = 64; // was 5
            const MAX_SIZE_BYTES: u32 = 32 * 1024 * 1024; // was 10MB
            const MAX_SIZE_TIME_NS: u64 = 6_000_000_000; // was 2s
            element.set_property("max-size-buffers", MAX_SIZE_BUFFERS);
            element.set_property("max-size-bytes", MAX_SIZE_BYTES);
            element.set_property("max-size-time", MAX_SIZE_TIME_NS);
            tracing::info!(
                MAX_SIZE_BUFFERS,
                MAX_SIZE_BYTES,
                MAX_SIZE_TIME_NS,
                "video_window: bumped multiqueue limits"
            );
        }
    });
}

/// video widget plus a transparent click surface. fullscreen controls are
/// intentionally omitted for now: the prior static bar never hid and captured
/// pointer input. the main playerbar remains the fullscreen control surface.
fn build_video_area(
    app: &AppHandle<Wry>,
    window: &gtk::Window,
    video: &gtk::Widget,
    chromeless: bool,
) -> (gtk::Overlay, Vec<gtk::Widget>, gtk::Image) {
    let overlay = gtk::Overlay::new();
    overlay.add(video);
    force_black_background(&overlay);

    // A video widget does not receive button events itself. Stationary clicks
    // toggle playback; once the pointer crosses this threshold the same press
    // becomes a standard GTK window drag instead.
    //
    // NOT given a black background like the layers above: `events` is an
    // overlay *child* (raised above the video, not behind it) purely to
    // catch input across the whole area, and painting it opaque hid the
    // actual video underneath entirely (a totally black window).
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
        let had_press = press_for_up.borrow_mut().take().is_some();
        tracing::info!(
            button = ev.button(),
            had_press,
            "video_window: button_release_event fired"
        );
        if ev.button() == 1 && had_press {
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
    window.connect_key_press_event(move |_, ev| {
        let keyval = ev.keyval().name();
        // logged unconditionally (not just on space/escape) - if this line
        // never shows up in charnel.log for a keypress the user swears they
        // made, the event isn't reaching gtk at all (most likely the window
        // never got keyboard focus - see connect_focus_in/out_event above),
        // which is a completely different fix than a logic bug in here.
        tracing::info!(?keyval, "video_window: key_press_event fired");
        match keyval.as_deref() {
            Some("space") => {
                let _ = handle_on_main(&app_for_keys, VideoCommand::TogglePlay);
                glib::Propagation::Stop
            }
            Some("Escape") => {
                let _ = handle_on_main(&app_for_keys, VideoCommand::Close);
                glib::Propagation::Stop
            }
            _ => glib::Propagation::Proceed,
        }
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
        return (overlay, Vec::new(), flash_icon);
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
    // sits to the left of the close button, with enough of a gap that their
    // hover backgrounds don't touch (a smaller gap here previously left the
    // two buttons' hover highlights overlapping).
    fullscreen_btn.set_margin_end(56);
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
    // manager would otherwise put one. a real `Button` (relief none, like
    // close/fullscreen above) so it gets the same hover-highlight
    // background instead of the plain `EventBox` this used to be, which had
    // no hover feedback at all.
    let resize_grip = gtk::Button::new();
    resize_grip.set_relief(gtk::ReliefStyle::None);
    resize_grip.set_halign(gtk::Align::End);
    resize_grip.set_valign(gtk::Align::End);
    resize_grip.set_size_request(18, 18);
    resize_grip.add_events(gdk::EventMask::BUTTON_PRESS_MASK | gdk::EventMask::ENTER_NOTIFY_MASK);
    resize_grip.set_tooltip_text(Some("resize window"));
    // a single small corner-triangle glyph rather than two oversized slash
    // characters at default label size (which rendered as a blocky "//").
    let grip_label = gtk::Label::new(None);
    grip_label.set_markup("<span size='small'>\u{25E2}</span>");
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

    (
        overlay,
        vec![
            close.upcast(),
            fullscreen_btn.upcast(),
            resize_grip.upcast(),
        ],
        flash_icon,
    )
}

/// undecorated toplevel windows still inherit gtk's light ".background" css
/// class, and the overlay/eventbox panes layered on top have their own
/// default background too - wherever the real video allocation doesn't
/// exactly cover the window (a manual resize past the source aspect ratio,
/// or the margin the chromeless close/resize controls float in), that
/// theme background shows through as a faint white edge. force every layer
/// here to plain black instead, since a media player window should never
/// show the desktop theme through its own edges.
fn force_black_background(widget: &impl IsA<gtk::Widget>) {
    let css = gtk::CssProvider::new();
    if css
        .load_from_data(b"* { background-color: black; border: none; box-shadow: none; }")
        .is_ok()
    {
        widget
            .style_context()
            .add_provider(&css, gtk::STYLE_PROVIDER_PRIORITY_APPLICATION);
    }
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
///
/// `new_sync_emit` (the previous choice here) emits signals synchronously
/// *from whatever thread posted the underlying bus message* - i.e. GStreamer's
/// own streaming/bus thread, not the GTK main thread `WINDOW` (a thread_local)
/// lives on. every handler below touching `WINDOW`/`emit_state` therefore saw
/// an empty thread-local and silently no-op'd its state update (events still
/// reached the webview since `emit_state`'s `None` branch still forwards
/// them, which is why playback/position looked fine) - `w.state.state` never
/// actually left `Loading`, so `resolve_toggle()` always resolved to `Play`
/// and pause never worked. plain `new()` attaches a bus-watching GSource to
/// the thread-default `MainContext` instead, so every signal below is
/// correctly marshaled onto the GTK main thread this function is called from.
fn connect_play_signals(app: &AppHandle<Wry>, play: &Play) -> PlaySignalAdapter {
    let adapter = PlaySignalAdapter::new(play);

    adapter.connect_media_info_updated(move |_, info| {
        let Some(video) = info.video_streams().into_iter().next() else {
            return;
        };
        let (source_width, source_height) = (video.width(), video.height());
        if source_width <= 0 || source_height <= 0 {
            return;
        }

        WINDOW.with(|cell| {
            let mut window = cell.borrow_mut();
            let Some(window) = window.as_mut().filter(|window| !window.sized_to_video) else {
                return;
            };
            let (width, height) = fit_initial_window(source_width, source_height);
            window.window.resize(width, height);
            window.sized_to_video = true;
            tracing::info!(
                source_width,
                source_height,
                width,
                height,
                "video_window: sized to video aspect ratio"
            );
        });
    });

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
    adapter.connect_state_changed(move |_, state| {
        tracing::info!(?state, "video_window: connect_state_changed fired");
        match state {
            PlayState::Playing => emit_state(&a, VideoEvent::Playing),
            PlayState::Paused => emit_state(&a, VideoEvent::Paused),
            _ => {}
        }
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
            return;
        }
        // every other warning was previously silently dropped - queue/decoder
        // underrun warnings ("there may be a timestamping problem", "a lot of
        // buffers are being dropped", etc) surface here too, and are the most
        // direct signal for diagnosing stutter/glitchy playback - log them
        // rather than losing them.
        tracing::warn!(message = %message, "video_window: pipeline warning");
    });

    adapter
}

/// fold into local state and only emit when something actually changed, so a
/// 1Hz position tick doesn't spam the webview with redundant updates.
fn emit_state(app: &AppHandle<Wry>, event: VideoEvent) {
    let changed = WINDOW.with(|cell| match cell.borrow_mut().as_mut() {
        Some(w) => w.state.apply(&event),
        // events can arrive after the window is gone; forward them so the
        // webview still sees a terminal state. also hit (spuriously) if a
        // signal callback ever runs off the GTK main thread again, since
        // `WINDOW` is thread_local - logged so that regression is obvious
        // next time instead of silently no-op'ing state updates again (see
        // the `new_sync_emit` -> `new` fix in `connect_play_signals`).
        None => {
            tracing::warn!(
                ?event,
                "video_window: emit_state found no window (gone, or wrong thread)"
            );
            true
        }
    });
    if changed {
        emit_event(app, &event);
    }
}
