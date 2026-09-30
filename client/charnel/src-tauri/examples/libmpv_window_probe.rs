// libmpv experimental player spike, take 2 (docs/libmpv-experimental-player-plan.md).
//
// libmpv_probe.rs (bare console binary, no windowing event loop) showed
// `vid = no` for a file that has a video track - mpv silently disabled
// video and only played audio. hypothesis: mpv's macOS video output needs
// a live Cocoa run loop pumped on the main thread, which a plain `fn main`
// console binary never has. charnel's real process always has one (tao/wry
// own it), so this probe pumps a real `tao` event loop on the main thread -
// same crate/version tauri-runtime-wry uses - while mpv plays on a
// background thread, to mirror the actual target environment.
//
// usage: cargo run --example libmpv_window_probe -- /path/to/file.mp4

use libmpv2::{events::Event, Format, Mpv};
use std::{env, thread};
use tao::event::{Event as TaoEvent, StartCause};
use tao::event_loop::{ControlFlow, EventLoop};

fn main() {
    let path = env::args()
        .nth(1)
        .expect("usage: libmpv_window_probe <media file path>");

    let event_loop = EventLoop::new();

    thread::spawn(move || {
        let mpv = Mpv::new().expect("mpv init");
        // NOTE: create_client(Some(name)) is buggy in libmpv2 6.0.0 (see
        // libmpv_probe.rs) - use None.
        let events = mpv.create_client(None).expect("create_client");
        events.disable_deprecated_events().ok();
        events.observe_property("eof-reached", Format::Flag, 0).ok();

        mpv.set_property("loop-file", "inf").ok();
        mpv.command("loadfile", &[&path]).expect("loadfile");
        println!("loaded {path} (looping)");

        // fullscreen toggle test, timed relative to first PlaybackRestart
        // (not a fixed sleep - loadfile is async and a fixed sleep before
        // playback actually starts just queues the property changes too
        // early to have any visible effect).
        let mut fullscreen_at: Option<u32> = None;
        let mut toggled_on = false;

        loop {
            match events.wait_event(1.0) {
                Some(Ok(Event::PlaybackRestart)) => {
                    println!("event: PlaybackRestart");
                    for name in ["current-vo", "video-codec", "vid"] {
                        match mpv.get_property::<String>(name) {
                            Ok(value) => println!("diag {name} = {value}"),
                            Err(err) => println!("diag {name} = <error: {err:?}>"),
                        }
                    }
                    if fullscreen_at.is_none() {
                        fullscreen_at = Some(2);
                    }
                }
                Some(Ok(Event::EndFile(reason))) => {
                    // idle mode (Mpv::new() default) keeps the window open
                    // after eof - don't exit here, only on real Shutdown
                    // (user closed the window), to test that separately.
                    println!("end-file: {reason:?} (window stays open, idle mode)");
                }
                Some(Ok(Event::Shutdown)) => {
                    println!("shutdown (window closed?)");
                    break;
                }
                Some(Ok(event)) => println!("event: {event:?}"),
                Some(Err(err)) => println!("event error: {err:?}"),
                None => {}
            }

            // wait_event(1.0) times out roughly once a second when idle, so
            // this is a rough-enough countdown for a one-off spike test.
            if let Some(secs) = fullscreen_at {
                if secs == 0 {
                    toggled_on = !toggled_on;
                    println!(
                        "set fullscreen={toggled_on} -> {:?}",
                        mpv.set_property("fullscreen", toggled_on)
                    );
                    fullscreen_at = Some(3);
                } else {
                    fullscreen_at = Some(secs - 1);
                }
            }
        }
        std::process::exit(0);
    });

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let TaoEvent::NewEvents(StartCause::Init) = event {
            println!("tao event loop pumping (native run loop active)");
        }
    });
}
