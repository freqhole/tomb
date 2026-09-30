// libmpv experimental player spike (docs/libmpv-experimental-player-plan.md).
// standalone, no tauri involved - just proves libmpv2 can open/play a local
// audio or video file. for video, default vo (gpu) should open its own
// native window since we never set `wid`.
//
// usage: cargo run --example libmpv_probe -- /path/to/file.mp4

use libmpv2::{events::Event, Format, Mpv};
use std::env;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = env::args()
        .nth(1)
        .expect("usage: libmpv_probe <media file path>");

    let mpv = Mpv::new()?;
    // NOTE: libmpv2 6.0.0's create_client(Some(name)) drops the CString
    // before using its pointer (use-after-free -> null handle -> panic).
    // pass None to sidestep the bug until upstream fixes it.
    let events = mpv.create_client(None)?;
    events.disable_deprecated_events()?;
    events.observe_property("time-pos", Format::Double, 0)?;
    events.observe_property("pause", Format::Flag, 0)?;
    events.observe_property("eof-reached", Format::Flag, 0)?;

    mpv.command("loadfile", &[&path])?;
    println!("loaded {path}, waiting for playback to end (ctrl-c to abort)...");

    let mut diagnostics_printed = false;
    loop {
        match events.wait_event(1.0) {
            Some(Ok(Event::EndFile(reason))) => {
                println!("end-file: {reason:?}");
                break;
            }
            Some(Ok(Event::Shutdown)) => {
                println!("shutdown (window closed?)");
                break;
            }
            Some(Ok(Event::PlaybackRestart)) => {
                println!("event: PlaybackRestart");
                if !diagnostics_printed {
                    diagnostics_printed = true;
                    print_diagnostics(&mpv);
                }
            }
            Some(Ok(event)) => println!("event: {event:?}"),
            Some(Err(err)) => println!("event error: {err:?}"),
            None => {}
        }
    }

    Ok(())
}

// mpv runs with --no-terminal in embedded mode, so its own log output is
// suppressed - poll a few properties directly instead to see whether video
// actually got selected/rendered.
fn print_diagnostics(mpv: &Mpv) {
    for name in ["current-vo", "video-codec", "vid", "track-list/count"] {
        match mpv.get_property::<String>(name) {
            Ok(value) => println!("diag {name} = {value}"),
            Err(err) => println!("diag {name} = <error: {err:?}>"),
        }
    }
}
