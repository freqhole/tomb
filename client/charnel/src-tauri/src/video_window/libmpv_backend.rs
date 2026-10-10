// separate video window, backed by libmpv (in-process, via the `libmpv2`
// crate) - the only video window backend now that gstreamer/gtk and the
// shelled-out `mpv` subprocess variants have been removed. dispatched to
// on every desktop platform (linux, macOS, windows) whenever the
// experimental player toggle is on - see `mod.rs`.
//
// threading: libmpv owns its own native window entirely outside this
// process's gtk setup, so there's no gtk-main-thread affinity to respect -
// state lives behind a plain `Mutex`. libmpv delivers every lifecycle
// signal (including a user closing the window) as one unified in-process
// event stream (`Event::Shutdown`), so there's no
// "socket EOF vs. our own close() raced" ambiguity to special-case - the
// event-reading thread is the single place that clears `WINDOW` and emits
// `VideoEvent::Closed`, whether the quit was user- or command-initiated. a
// generation counter guards against a stale reader thread (from a window
// that's mid-quit) clobbering a brand new window's state if `Close` is
// immediately followed by `Load` - see `close_window`'s doc comment.
//
// see `docs/libmpv-experimental-player-plan.md` for the spike that proved
// this approach out (own native window with no `wid` set, fullscreen
// toggle, close detection - all confirmed working on macOS 2026-09-29).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use libmpv2::events::{Event as MpvEvent, PropertyData};
use libmpv2::{mpv_end_file_reason, Format, Mpv};
use tauri::{AppHandle, Wry};

use super::backend::{classify_error, PlayerState, VideoCommand, VideoEvent};
use super::{emit_event, VideoWindowDiagnostics};

struct LibmpvWindow {
    mpv: Mpv,
    state: PlayerState,
    /// see module doc comment - guards against a stale reader thread
    /// clearing a newer window's state.
    generation: u64,
}

static WINDOW: Mutex<Option<LibmpvWindow>> = Mutex::new(None);
static GENERATION: AtomicU64 = AtomicU64::new(0);
/// the user's last explicit fullscreen/windowed choice, remembered across
/// loads and window recreation - same convention as gst.rs/mpv.rs.
static DEFAULT_FULLSCREEN: AtomicBool = AtomicBool::new(true);
/// the user's last explicitly-picked output device (mpv's own `name`, e.g.
/// `pipewire/alsa_output...` or `auto`) - remembered so a video window
/// opened *after* the pick still uses it, not mpv's default. session-only
/// (not persisted to disk config), matching the device picker's own
/// established "never cache across restarts, devices can change"
/// philosophy (see `tomb-audio-device-picker-feature.md`).
static PREFERRED_OUTPUT_DEVICE: Mutex<Option<String>> = Mutex::new(None);

fn poisoned() -> String {
    "libmpv window lock poisoned".to_string()
}

// mpv_create() returns NULL if LC_NUMERIC isn't "C" - gtk's own
// setlocale(LC_ALL, "") during window init adopts the user's locale,
// which breaks mpv's internal decimal-point parsing. reset it right
// before creating any Mpv instance rather than relying on init order
// elsewhere. gtk-specific (only linux dispatches to this backend today -
// `libc` is a linux-only dependency, see Cargo.toml).
#[cfg(target_os = "linux")]
fn reset_locale_for_mpv() {
    unsafe {
        libc::setlocale(libc::LC_NUMERIC, c"C".as_ptr());
    }
}

#[cfg(not(target_os = "linux"))]
fn reset_locale_for_mpv() {}

// mpv's cocoa video-output backend (video/out/mac/common.swift's
// `setAppIcon()`) unconditionally replaces `NSApp.applicationIconImage`
// with its own baked-in icon the moment it opens a window, UNLESS it
// thinks it's running inside someone else's app bundle - which it decides
// purely by checking the `MPVBUNDLE` environment variable (see
// `osdep/mac/app_hub.swift`'s `isBundle`). without this, every video
// window replaces the dock/cmd-tab icon with mpv's logo for the whole
// process. set before every window spawn (idempotent) rather than once
// at process start, since the embedding tauri process has no single
// "mpv is about to init" hook otherwise.
#[cfg(target_os = "macos")]
fn suppress_macos_icon_override() {
    unsafe {
        std::env::set_var("MPVBUNDLE", "true");
    }
}

#[cfg(not(target_os = "macos"))]
fn suppress_macos_icon_override() {}

// MoltenVK (the vulkan driver mpv's gpu-next vo needs on macOS) isn't a
// normal dlopen'd dependency - the vulkan loader instead discovers it via
// an ICD manifest json, normally only found through a system-wide
// homebrew install. `scripts/fetch-mpv-runtime.sh` bundles the dylib as a
// `frameworks` entry (flat, at Contents/Frameworks/) and the manifest as
// a `resources` entry - tauri's `resources` key preserves the full given
// relative path rather than flattening it, so the manifest actually
// lands at Contents/Resources/mpv-runtime/lib/MoltenVK_icd.json
// (confirmed via an actual local build 2026-10-02 - NOT Frameworks/,
// despite living right next to the dylib in the source tree). point the
// loader directly at the bundled manifest before mpv/vulkan ever
// initializes, so a real end-user install with no homebrew at all still
// finds a driver (confirmed for real 2026-10-02: without this, every
// vulkan context fails with VK_ERROR_INCOMPATIBLE_DRIVER - audio plays,
// no video window, no error dialog). only set when the bundled file
// actually exists - absent in `tauri dev` (no Resources dir at all),
// where the system's own homebrew-provided MoltenVK install already
// works today.
#[cfg(target_os = "macos")]
fn set_vulkan_icd_env() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    // .../Contents/MacOS/charnel -> .../Contents/Resources/mpv-runtime/lib/MoltenVK_icd.json
    let Some(icd_path) =
        exe.parent()
            .and_then(|macos_dir| macos_dir.parent())
            .map(|contents_dir| {
                contents_dir
                    .join("Resources")
                    .join("mpv-runtime")
                    .join("lib")
                    .join("MoltenVK_icd.json")
            })
    else {
        return;
    };
    if icd_path.is_file() {
        unsafe {
            std::env::set_var("VK_ICD_FILENAMES", &icd_path);
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn set_vulkan_icd_env() {}

fn mpv_err(e: libmpv2::Error) -> String {
    format!("libmpv command failed: {e}")
}

/// validate that libmpv can be initialized, without opening a window - a
/// bare `Mpv::new()` never creates one on its own (confirmed during the
/// spike): only `force-window`/an actual video track does, and neither
/// happens here.
pub fn diagnostics() -> VideoWindowDiagnostics {
    if !grimoire::player::libmpv::is_libmpv_available() {
        return VideoWindowDiagnostics {
            available: false,
            version: None,
            error: Some("libmpv is not installed on this system".to_string()),
        };
    }
    reset_locale_for_mpv();
    match Mpv::new() {
        Ok(mpv) => VideoWindowDiagnostics {
            available: true,
            version: mpv.get_property::<String>("mpv-version").ok(),
            error: None,
        },
        Err(e) => VideoWindowDiagnostics {
            available: false,
            version: None,
            error: Some(format!("libmpv init failed: {e}")),
        },
    }
}

/// entry point from the tauri command. every command runs on a background
/// thread and reports failures asynchronously via `VideoEvent::Error`,
/// mirroring `mpv::dispatch`'s fire-and-forget shape.
pub fn dispatch(app: AppHandle<Wry>, command: VideoCommand) -> Result<(), String> {
    std::thread::spawn(move || {
        if let Err(e) = handle_command(&app, command) {
            // previously only reached the frontend via `VideoEvent::Error`
            // - confirmed real 2026-10-08: an `Mpv::with_initializer`
            // failure (bad gpu-api/gpu-context option) left zero trace in
            // charnel.log, not even mpv's own log-file (never created -
            // the failing `set_option` bailed out before reaching that
            // later call), making the actual failure reason invisible
            // without digging through frontend/browser console state.
            tracing::error!(error = %e, "video_window: command failed");
            emit_event(
                &app,
                &VideoEvent::Error {
                    error_type: classify_error(&e).to_string(),
                    message: e,
                },
            );
        }
    });
    Ok(())
}

fn handle_command(app: &AppHandle<Wry>, command: VideoCommand) -> Result<(), String> {
    match command {
        VideoCommand::Close => {
            close_window();
            Ok(())
        }
        VideoCommand::Load {
            path,
            title,
            start_seconds,
        } => open_or_reuse(app, &path, title.as_deref(), start_seconds),
        // works whether or not a window is currently open: with one open,
        // queries its live `Mpv`; with none, spins up a throwaway headless
        // `Mpv::new()` just to read `audio-device-list` (mpv's device list
        // reflects the system's actual devices, not anything tied to a
        // specific window/instance - see `list_audio_devices`'s own doc
        // comment) - so the picker works any time libmpv is the active
        // player, not only while video is actually loaded.
        VideoCommand::ListOutputDevices => {
            let devices = {
                let guard = WINDOW.lock().map_err(|_| poisoned())?;
                match guard.as_ref() {
                    Some(w) => grimoire::player::libmpv::list_audio_devices(&w.mpv),
                    None => {
                        drop(guard);
                        query_devices_headless()
                    }
                }
            };
            emit_event(app, &VideoEvent::OutputDevices { devices });
            Ok(())
        }
        VideoCommand::SetOutputDevice { name } => {
            *PREFERRED_OUTPUT_DEVICE.lock().map_err(|_| poisoned())? = Some(name.clone());
            let guard = WINDOW.lock().map_err(|_| poisoned())?;
            if let Some(w) = guard.as_ref() {
                w.mpv
                    .set_property("audio-device", name.as_str())
                    .map_err(mpv_err)?;
            }
            // no window open yet: nothing live to apply to - the choice is
            // still remembered above and gets applied the next time one
            // opens (`spawn_mpv`), so this is a legitimate no-op, not an
            // error.
            Ok(())
        }
        other => {
            let mut guard = WINDOW.lock().map_err(|_| poisoned())?;
            let w = guard
                .as_mut()
                .ok_or_else(|| "no video window is open".to_string())?;
            // resolve toggles against real state before touching mpv, same
            // convention as gst.rs/mpv.rs.
            let resolved = match other {
                VideoCommand::TogglePlay => w.state.resolve_toggle(),
                VideoCommand::ToggleFullscreen => VideoCommand::SetFullscreen {
                    fullscreen: !w.state.fullscreen,
                },
                c => c,
            };
            w.state.apply_command(&resolved);
            let wid = w.mpv.get_property::<i64>("window-id").ok();
            let result = apply(w, &resolved);
            drop(guard);
            // a user who lost track of the window (e.g. cmd+tabbed away
            // from a fullscreen video on macOS, which has no dock icon of
            // its own to click back to) has no other way to find it again
            // - raise it on play/show so those controls double as "bring
            // the video back". deliberately NOT on pause - pausing
            // something already out of view shouldn't yank it back to
            // front.
            if result.is_ok() && matches!(resolved, VideoCommand::Play | VideoCommand::Show) {
                if let Some(wid) = wid {
                    raise_window(app, wid);
                }
            }
            result
        }
    }
}

fn apply(w: &mut LibmpvWindow, command: &VideoCommand) -> Result<(), String> {
    match command {
        VideoCommand::Play => w.mpv.set_property("pause", false).map_err(mpv_err),
        VideoCommand::Pause => w.mpv.set_property("pause", true).map_err(mpv_err),
        VideoCommand::Seek { seconds } => w
            .mpv
            .command("seek", &[&seconds.to_string(), "absolute"])
            .map_err(mpv_err),
        VideoCommand::SetVolume { volume } => w
            .mpv
            .set_property("volume", volume * 100.0)
            .map_err(mpv_err),
        VideoCommand::SetFullscreen { fullscreen } => {
            DEFAULT_FULLSCREEN.store(*fullscreen, Ordering::Relaxed);
            w.mpv
                .set_property("fullscreen", *fullscreen)
                .map_err(mpv_err)
        }
        // Close is handled by `close_window()` before reaching here; Load
        // and device commands are handled before this point; toggles are
        // resolved by the caller; Show only raises the window (handled by
        // the caller too, via `window-id` - nothing for mpv itself to do).
        VideoCommand::Close
        | VideoCommand::Load { .. }
        | VideoCommand::TogglePlay
        | VideoCommand::Show
        | VideoCommand::ToggleFullscreen
        | VideoCommand::ListOutputDevices
        | VideoCommand::SetOutputDevice { .. } => Ok(()),
    }
}

/// bring mpv's own native window to front, off the libmpv window's
/// `window-id` property (a raw platform window handle - on macOS, an
/// `NSWindow*`; on windows, an `HWND`; see `video/out/mac/common.swift`'s
/// and `video/out/w32_common.c`'s `VOCTRL_GET_WINDOW_ID`). AppKit calls
/// must happen on the main thread, unlike every other mpv command here or
/// the win32 calls below, which is why only the macOS branch needs
/// `run_on_main_thread` instead of just running inline on
/// `handle_command`'s background thread.
fn raise_window(app: &AppHandle<Wry>, wid: i64) {
    #[cfg(target_os = "macos")]
    {
        let app = app.clone();
        let _ = app.run_on_main_thread(move || raise_window_macos(wid));
    }
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        raise_window_windows(wid);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // linux: no platform-specific raise-to-front wired up yet - mpv
        // only reports `window-id` for its X11 backend (not wayland, which
        // has no api for one app to force-focus another's window at all),
        // so this would only ever help under an X11 session anyway.
        let _ = (app, wid);
    }
}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
fn raise_window_macos(wid: i64) {
    use cocoa::appkit::{NSApp, NSApplication, NSWindow};
    use cocoa::base::{id, nil, YES};

    unsafe {
        let ns_window = wid as usize as id;
        if ns_window.is_null() {
            return;
        }
        ns_window.makeKeyAndOrderFront_(nil);
        NSApp().activateIgnoringOtherApps_(YES);
    }
}

#[cfg(target_os = "windows")]
fn raise_window_windows(wid: i64) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };

    unsafe {
        let hwnd = wid as usize as HWND;
        if hwnd.is_null() {
            return;
        }
        if IsIconic(hwnd) != 0 {
            ShowWindow(hwnd, SW_RESTORE);
        }
        SetForegroundWindow(hwnd);
    }
}

/// open the window (spawning libmpv on first use) and start the given file.
fn open_or_reuse(
    app: &AppHandle<Wry>,
    path: &str,
    title: Option<&str>,
    start_seconds: Option<f64>,
) -> Result<(), String> {
    let already_open = WINDOW.lock().map_err(|_| poisoned())?.is_some();
    if !already_open {
        spawn_mpv(app)?;
    }

    tracing::info!(path, title = ?title, "video_window: libmpv loading");

    let mut guard = WINDOW.lock().map_err(|_| poisoned())?;
    let w = guard
        .as_mut()
        .ok_or_else(|| "libmpv failed to start".to_string())?;
    w.state = PlayerState::default();
    w.state.apply_command(&VideoCommand::Load {
        path: path.to_string(),
        title: title.map(str::to_string),
        start_seconds,
    });
    w.mpv
        .set_property("title", title.unwrap_or("video"))
        .map_err(mpv_err)?;

    // mpv's real `loadfile` signature is <url> [<flags> [<index> [<options>]]]
    // - <index> sits before <options>, so a start= option needs the -1
    // placeholder in the index slot (same hard-won fix as mpv.rs's own
    // loadfile call - see its doc comment for the full story).
    let args = loadfile_args(path, start_seconds);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    w.mpv.command("loadfile", &arg_refs).map_err(mpv_err)?;

    // `apply_command`'s Load arm resets `fullscreen` to `false` - reapply
    // the user's remembered choice after that reset on every load, same
    // convention as gst.rs/mpv.rs.
    let fullscreen = DEFAULT_FULLSCREEN.load(Ordering::Relaxed);
    w.state.fullscreen = fullscreen;
    w.mpv
        .set_property("fullscreen", fullscreen)
        .map_err(mpv_err)
}

/// query `audio-device-list` without an open video window, via a throwaway
/// headless `Mpv` context (never opens a window on its own - see
/// `diagnostics()`'s doc comment) that's dropped immediately after reading
/// the property.
fn query_devices_headless() -> Vec<grimoire::player::AudioDeviceInfo> {
    if !grimoire::player::libmpv::is_libmpv_available() {
        return Vec::new();
    }
    reset_locale_for_mpv();
    match Mpv::new() {
        Ok(mpv) => grimoire::player::libmpv::list_audio_devices(&mpv),
        Err(e) => {
            tracing::warn!(error = %e, "video_window: headless libmpv init failed for device query");
            Vec::new()
        }
    }
}

/// spawn libmpv (creating its context on first use) and start the
/// background thread that turns its event stream into `VideoEvent`s.
///
/// tried creating the `Mpv` context via `app.run_on_main_thread(...)`
/// instead of inline here (2026-10-07 theory: mpv's normal macOS entry
/// point, `cocoa_main`, keeps `[NSApp run]` on the real main thread
/// specifically because CoreAudio/AVFoundation setup has real thread/
/// run-loop expectations, and `dispatch()` runs every command - this one
/// included - on a one-off `std::thread::spawn` thread with no run loop
/// at all) - confirmed real 2026-10-07 this made no difference
/// whatsoever (same `core-idle=true` forever, same zero demux/codec/AO/
/// VO progress in mpv's own log). reverted to the simpler inline call;
/// see `scripts/fetch-mpv-runtime.sh`'s macOS-12-minimum plan for the
/// current leading theory instead (swift-build disabled).
fn spawn_mpv(app: &AppHandle<Wry>) -> Result<(), String> {
    if !grimoire::player::libmpv::is_libmpv_available() {
        return Err("failed to start libmpv: not installed on this system".to_string());
    }

    let (mpv, events) = create_mpv_and_events(app)?;

    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let mut guard = WINDOW.lock().map_err(|_| poisoned())?;
        *guard = Some(LibmpvWindow {
            mpv,
            state: PlayerState::default(),
            generation,
        });
    }

    let app_for_events = app.clone();
    std::thread::spawn(move || read_libmpv_events(app_for_events, events, generation));
    tracing::info!("video_window: libmpv started");
    Ok(())
}

/// everything that creates/configures the `Mpv` context and its events
/// client - split out of `spawn_mpv` only because it was briefly also
/// called via `run_on_main_thread` (see `spawn_mpv`'s doc comment);
/// kept split since it's a clean separation of concerns either way.
fn create_mpv_and_events(app: &AppHandle<Wry>) -> Result<(Mpv, Mpv), String> {
    let app_config = crate::app_config::FreqholeAppConfig::load(app).unwrap_or_default();
    tracing::info!(
        hwdec = %app_config.video_hwdec,
        extra_options = ?app_config.video_mpv_extra_options,
        "video_window: applying mpv config"
    );
    reset_locale_for_mpv();
    suppress_macos_icon_override();
    set_vulkan_icd_env();
    let mpv = Mpv::with_initializer(|init| {
        init.set_option("geometry", "960x540")?;
        // "auto" lets mpv pick the best hw decode method per-platform/
        // codec and falls back to software when none applies - a safe
        // default everywhere, configurable via charnel-config.toml's
        // `video_hwdec` for anyone who needs to force it off.
        init.set_option("hwdec", app_config.video_hwdec.as_str())?;
        // raw passthrough for anything else libmpv takes (e.g.
        // `gpu-context = "cocoa"` to force OpenGL over Vulkan/MoltenVK on
        // GPUs where the latter glitches - confirmed real 2026-10-08 on
        // an Intel Iris iGPU under macOS 12, absent on a newer macOS 14
        // Intel machine testing the exact same build). empty by default -
        // mpv's own vo=gpu-next/Vulkan-via-MoltenVK auto-selection applies
        // unless a user opts into an override here.
        for (key, value) in &app_config.video_mpv_extra_options {
            init.set_option(key.as_str(), value.as_str())?;
        }
        // opens a window immediately rather than only once a video track
        // decodes. NOTE: NOT "immediate" - that specific choice value is
        // rejected with `Raw(-4)` (MPV_ERROR_INVALID_PARAMETER) when set
        // pre-init, only working as a post-init `set_property`. `yes`
        // has no such issue pre-init and forces the window the same way,
        // just once the file's been probed rather than the instant
        // loading starts - a minor UX difference, not a functional one.
        init.set_option("force-window", "yes")?;
        // mpv's builtin `libmpv` profile (see `mpv --show-profile=libmpv`)
        // forces osc=no for every libmpv embedder, unlike the CLI player
        // where the OSC is on by default - without this, there's no
        // seekbar/play-pause/track-cycling overlay at all.
        init.set_option("osc", "yes")?;
        // default bottombar layout. colors are all documented osc.lua
        // script-opts (see mpv's ON SCREEN CONTROLLER manual section) -
        // background is left at its default so the magenta foreground
        // elements stay visible against it.
        init.set_option(
            "script-opts",
            "osc-buttons_color=#FF00FF,\
             osc-small_buttonsL_color=#FF00FF,\
             osc-small_buttonsR_color=#FF00FF,\
             osc-top_buttons_color=#FF00FF,\
             osc-timecode_color=#FF00FF,\
             osc-title_color=#FF00FF,\
             osc-time_pos_color=#FF00FF,\
             osc-time_pos_outline_color=#FF00FF,\
             osc-held_element_color=#CC00CC,\
             osc-vidscale=no,\
             osc-scalefullscreen=2.5,\
             osc-scalewindowed=3.5,\
             osc-playlist_prev_mbtn_left_command=script-message charnel-osc prev,\
             osc-playlist_next_mbtn_left_command=script-message charnel-osc next",
        )?;
        // the OSC greys out (and ignores clicks on) its prev/next buttons
        // unless mpv's own playlist has a neighbour or `loop-playlist` is
        // set - and it's never populated here (every load is `loadfile
        // ... replace`), so `loop-playlist=inf` is what enables them.
        // `keep-open=always` stops that loop from actually restarting the
        // file at EOF (mpv parks on the last frame instead, reported via
        // `eof-reached` below), and `keep-open-pause=no` keeps that park
        // from also flipping `pause` and confusing the playerbar.
        init.set_option("loop-playlist", "inf")?;
        init.set_option("keep-open", "always")?;
        init.set_option("keep-open-pause", "no")?;
        // mpv stays completely silent about *why* a file fails to play
        // (codec missing, no video/audio output found, decoder error,
        // etc.) unless it's told to log that detail somewhere - errors
        // encountered applying mpv options/commands are logged via
        // `tracing::error!` into charnel.log instead (see `dispatch()`),
        // rather than mpv's own `log-file`/`msg-level=v`, which wrote a
        // separate, highly verbose `libmpv-video.log` file per session.
        Ok(())
    })
    .map_err(|e| format!("failed to start libmpv: {e}"))?;

    // apply whatever output device the user last picked (via
    // `VideoCommand::SetOutputDevice`, possibly before this window even
    // existed) - best-effort, a bad/unplugged device name shouldn't block
    // opening the window at all, just fall back to mpv's own default.
    if let Some(name) = PREFERRED_OUTPUT_DEVICE
        .lock()
        .map_err(|_| poisoned())?
        .clone()
    {
        if let Err(e) = mpv.set_property("audio-device", name.as_str()) {
            tracing::warn!(device = %name, error = %e, "video_window: failed to apply preferred output device");
        }
    }

    // explicit key/mouse bindings for the requested video-window UX:
    // single click or space toggles play/pause, double click toggles
    // fullscreen, escape leaves fullscreen. set explicitly rather than
    // relying on whatever built-in default bindings libmpv happens to
    // load when embedded via the C API (unlike the CLI player, that's
    // not documented/guaranteed behavior here) - removes any ambiguity.
    // the close button and corner resize handles come for free from the
    // OS's own window decorations (`border` is never set to "no"); the
    // on-screen play/pause/seek-bar overlay (`osc`) is mpv's own
    // default-on feature, also untouched.
    for (key, command) in [
        ("SPACE", "cycle pause"),
        ("MBTN_LEFT", "cycle pause"),
        ("MBTN_LEFT_DBL", "cycle fullscreen"),
        ("ESC", "set fullscreen no"),
    ] {
        let _ = mpv.command("keybind", &[key, command]);
    }

    // NOTE: create_client(Some(name)) is buggy in libmpv2 6.0.0 - drops the
    // `CString` before `mpv_create_client` reads its pointer (temporary-
    // lifetime bug in the crate itself) -> null handle -> panic. always
    // pass `None` until upstream fixes it (see
    // docs/libmpv-experimental-player-plan.md's spike findings).
    let events = mpv
        .create_client(None)
        .map_err(|e| format!("failed to create libmpv event client: {e}"))?;
    events
        .disable_deprecated_events()
        .map_err(|e| format!("libmpv event setup failed: {e}"))?;
    for (name, format) in [
        ("time-pos", Format::Double),
        ("duration", Format::Double),
        ("pause", Format::Flag),
        ("eof-reached", Format::Flag),
        ("fullscreen", Format::Flag),
    ] {
        let _ = events.observe_property(name, format, 0);
    }

    Ok((mpv, events))
}

fn read_libmpv_events(app: AppHandle<Wry>, events: Mpv, generation: u64) {
    // mpv_observe_property delivers one notification carrying the
    // CURRENT value immediately upon starting observation, for every
    // property - a fresh window has `pause=false` (mpv's idle default)
    // before the `loadfile` that follows `spawn_mpv` has even run, which
    // this handler would otherwise misread as "now playing" the instant
    // the window opens (same real bug found + fixed in grimoire's audio
    // backend, `libmpv.rs`, 2026-09-29 - see its own comment for the full
    // story). `duration` only ever gets a real value once a file has
    // actually opened, so use its first report as the "a load genuinely
    // happened" signal.
    let mut ever_loaded = false;
    loop {
        match events.wait_event(1.0) {
            Some(Ok(MpvEvent::PropertyChange {
                name: "time-pos",
                change: PropertyData::Double(seconds),
                ..
            })) => emit_state(&app, VideoEvent::Position { seconds }),
            Some(Ok(MpvEvent::PropertyChange {
                name: "duration",
                change: PropertyData::Double(seconds),
                ..
            })) => {
                ever_loaded = true;
                emit_state(&app, VideoEvent::Duration { seconds });
                // `pause` stays at its already-observed default (`false`)
                // for a load that starts playing immediately - no further
                // PropertyChange for it ever fires, since mpv only
                // notifies on actual value CHANGES past the initial one
                // (suppressed above via `ever_loaded`). query it directly
                // here, on the first signal a real file has loaded, so
                // the playerbar actually learns playback started instead
                // of waiting forever for a pause toggle that may never
                // come.
                let paused = events.get_property::<bool>("pause").unwrap_or(false);
                emit_state(
                    &app,
                    if paused {
                        VideoEvent::Paused
                    } else {
                        VideoEvent::Playing
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
                emit_state(
                    &app,
                    if paused {
                        VideoEvent::Paused
                    } else {
                        VideoEvent::Playing
                    },
                )
            }
            Some(Ok(MpvEvent::PropertyChange {
                name: "fullscreen",
                change: PropertyData::Flag(fullscreen),
                ..
            })) => emit_state(&app, VideoEvent::Fullscreen { fullscreen }),
            // with `keep-open=always` mpv never emits `EndFile(Eof)` for a
            // natural end - it parks at EOF and flips `eof-reached`.
            Some(Ok(MpvEvent::PropertyChange {
                name: "eof-reached",
                change: PropertyData::Flag(true),
                ..
            })) => {
                if ever_loaded {
                    emit_state(&app, VideoEvent::Ended);
                }
            }
            // routes the OSC's playlist prev/next buttons (rebound via
            // the `osc-playlist_{prev,next}_mbtn_left_command` script-opts
            // above to `script-message charnel-osc prev|next`) into
            // the exact same queue-aware action spume's OS-media-key and
            // control-socket handlers already use - mpv's own playlist is
            // never populated (every load uses `loadfile ... replace`),
            // so its native prev/next logic has nothing to act on.
            Some(Ok(MpvEvent::ClientMessage(args))) => {
                if args.first().copied() == Some("charnel-osc") {
                    match args.get(1).copied() {
                        Some("prev") => {
                            crate::media_session::emit_action(
                                &app,
                                crate::media_session::MediaSessionAction::Previous,
                            );
                        }
                        Some("next") => {
                            crate::media_session::emit_action(
                                &app,
                                crate::media_session::MediaSessionAction::Next,
                            );
                        }
                        _ => {}
                    }
                }
            }
            Some(Ok(MpvEvent::EndFile(reason))) => match reason {
                mpv_end_file_reason::Eof => emit_state(&app, VideoEvent::Ended),
                mpv_end_file_reason::Error => emit_state(
                    &app,
                    VideoEvent::Error {
                        error_type: "playback_failed".to_string(),
                        message: "libmpv failed to play this file".to_string(),
                    },
                ),
                _ => {}
            },
            // the single, unified "window/core is going away" signal -
            // whether the user closed the window or we sent `quit`
            // ourselves (`close_window` below). only clear `WINDOW` /
            // emit `Closed` if it's still *this* generation - otherwise a
            // `Close` immediately followed by a new `Load` would let this
            // stale thread wipe out the brand new window's state.
            Some(Ok(MpvEvent::Shutdown)) => {
                let still_current = WINDOW
                    .lock()
                    .map(|mut guard| {
                        let matches = guard.as_ref().is_some_and(|w| w.generation == generation);
                        if matches {
                            *guard = None;
                        }
                        matches
                    })
                    .unwrap_or(false);
                if still_current {
                    emit_event(&app, &VideoEvent::Closed);
                }
                return;
            }
            Some(Err(e)) => tracing::warn!(error = ?e, "video_window: libmpv event error"),
            Some(Ok(_)) | None => {}
        }
    }
}

/// build the `loadfile` command arguments. mpv's real signature is
/// `<url> [<flags> [<index> [<options>]]]` - `<index>` sits *before*
/// `<options>`, so a `start=` option needs the `-1` placeholder in the
/// index slot, or it gets mis-parsed as the index itself (same hard-won
/// fix as `mpv.rs`'s own loadfile call - see its doc comment for the full
/// story). pure/testable, unlike the rest of this module.
fn loadfile_args(path: &str, start_seconds: Option<f64>) -> Vec<String> {
    let mut args = vec![path.to_string(), "replace".to_string()];
    if let Some(seconds) = start_seconds.filter(|s| *s > 0.0) {
        args.push("-1".to_string());
        args.push(format!("start={seconds}"));
    }
    args
}

/// fold into local state and only emit when something actually changed,
/// mirroring `mpv.rs`'s/`gst.rs`'s `emit_state`.
fn emit_state(app: &AppHandle<Wry>, event: VideoEvent) {
    let changed = match WINDOW.lock() {
        Ok(mut guard) => match guard.as_mut() {
            Some(w) => w.state.apply(&event),
            None => true,
        },
        Err(_) => true,
    };
    if changed {
        emit_event(app, &event);
    }
}

/// ask libmpv to quit. deliberately does *not* touch `WINDOW` itself - the
/// event thread's `Shutdown` handler above is the single place that clears
/// it and emits `VideoEvent::Closed`, whether this was a user-initiated
/// close or this function. known limitation: a `Load` issued immediately
/// after `Close` (before the old instance's `Shutdown` is processed) will
/// see `already_open == true` and try to reuse the dying instance, which
/// likely no-ops rather than opening a fresh window - rare in practice
/// (requires sub-event-loop-tick timing), tracked in the plan doc rather
/// than fixed here.
fn close_window() {
    let guard = match WINDOW.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if let Some(w) = guard.as_ref() {
        // exit native macOS fullscreen (a Space transition) before asking
        // mpv to quit - closing/deallocating a window mid-fullscreen-
        // transition is a known source of stuck/unresponsive windows on
        // macOS. harmless no-op if not currently fullscreen. best-effort:
        // this must not block the actual quit below even if it fails.
        let _ = w.mpv.set_property("fullscreen", false);
        let _ = w.mpv.command("quit", &[]);
    }
}

/// no-op beyond asking libmpv to quit: libmpv is in-process (no subprocess
/// to leak, unlike `mpv.rs`'s shelled-out player) - dropping the charnel
/// process itself cleans everything up regardless. kept for symmetry with
/// `mpv::shutdown()` / the `super::shutdown()` call site in `mod.rs`.
pub fn shutdown() {
    close_window();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loadfile_without_start_omits_index_and_options() {
        assert_eq!(
            loadfile_args("/tmp/a.mp4", None),
            vec!["/tmp/a.mp4", "replace"]
        );
    }

    #[test]
    fn loadfile_ignores_a_non_positive_start() {
        assert_eq!(
            loadfile_args("/tmp/a.mp4", Some(0.0)),
            vec!["/tmp/a.mp4", "replace"]
        );
        assert_eq!(
            loadfile_args("/tmp/a.mp4", Some(-5.0)),
            vec!["/tmp/a.mp4", "replace"]
        );
    }

    #[test]
    fn loadfile_with_start_includes_the_index_placeholder() {
        // the `-1` here is load-bearing - see `loadfile_args`'s doc comment.
        // a regression here previously mis-parsed the start option as the
        // playlist index (mpv.rs's own hard-won fix).
        assert_eq!(
            loadfile_args("/tmp/a.mp4", Some(12.5)),
            vec!["/tmp/a.mp4", "replace", "-1", "start=12.5"]
        );
    }
}
