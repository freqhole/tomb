//! standalone libmpv smoke test - exercises the exact same
//! `grimoire::player::libmpv` backend charnel embeds, but in a bare
//! `cargo build` binary with no Tauri/WKWebView/P2P/database overhead.
//!
//! confirmed real 2026-10-07: the embedded player's core reports
//! `core-idle=true` forever after a `loadfile`, on real hardware, with
//! zero errors anywhere in mpv's own verbose log - this isolates
//! whether that's the dylib/grimoire code itself, or something about
//! running inside the full charnel process (WKWebView main thread,
//! Cocoa run loop ownership, signal handlers installed by wry, etc.).
//! run with the SAME dylib the installed app uses, e.g. on macOS:
//!
//! ```sh
//! DYLD_LIBRARY_PATH=/Applications/freqhole.app/Contents/Resources/mpv-runtime/lib \
//!     cargo run -p cli --bin rathole -- player-smoke-test /path/to/file.mp3
//! ```

use grimoire::player::{spawn_libmpv_player, PlayerCommand, PlayerController};
use std::path::PathBuf;
use std::time::Duration;

pub async fn run(path: PathBuf, seconds: u64) -> anyhow::Result<()> {
    let path_str = path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("path is not valid UTF-8"))?
        .to_string();

    println!("spawning libmpv player...");
    let player = spawn_libmpv_player().map_err(|e| anyhow::anyhow!("spawn failed: {e}"))?;
    let mut events = player.subscribe();

    println!("loading: {path_str}");
    player
        .send(PlayerCommand::Load {
            paths: vec![path_str],
            start_ms: None,
            start_paused: false,
        })
        .await
        .map_err(|e| anyhow::anyhow!("load command failed: {e}"))?;

    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining, events.recv()).await {
            Ok(Ok(event)) => println!("event: {event:?}"),
            Ok(Err(e)) => println!("event stream error: {e:?}"),
            Err(_) => println!("(no event for 1s+, still waiting...)"),
        }
    }

    println!("final snapshot: {:?}", player.snapshot());
    Ok(())
}
