//! tty shell — terminal entry point for rathole.
//!
//! owns: ratatui terminal lifecycle, crossterm event loop, the
//! grimoire-backed `LocalTransport`, and the toml statefile.

pub mod pending_remotes;
mod persist;
mod player;
mod run;
pub mod serve_monitor;
mod transport;

pub use transport::LocalTransport;

use std::path::PathBuf;

/// launch options for the tty shell.
#[derive(Debug, Clone, Default)]
pub struct LaunchOpts {
    /// path to a `freqhole-config.toml`. when `None`, falls back to
    /// the same defaults as the rest of the cli.
    pub config: Option<PathBuf>,
}

/// run the rathole tui. expects grimoire's config + database to be
/// initialised already (the cli does this before calling us).
///
/// owns the terminal lifecycle: `ratatui::init()` on entry, restore
/// on exit (including on error). also enables crossterm bracketed
/// paste so the peer-input modal can receive paste events as a single
/// `Event::Paste(String)` instead of one keypress per char.
///
/// best-effort enables the kitty keyboard protocol (CSI-u) so
/// terminals that support it (ghostty, wezterm, iterm2 with
/// "report all keys as escape codes", kitty) can distinguish
/// ctrl-m from Enter, ctrl-i from Tab, ctrl-h from Backspace, and
/// surface modifier+letter combos cleanly. silently no-ops on
/// terminals that ignore the request (notably macos Terminal.app,
/// where ctrl-m is forever Enter — see `terminal_quirks_warning`).
pub async fn run(opts: LaunchOpts) -> color_eyre::Result<()> {
    // silently upgrade freqhole-config.toml if its version differs
    // from the binary's. mirrors what charnel does on startup.
    // runs before ratatui takes the screen, so any warnings land
    // in the rathole log via tracing rather than scribbling on the
    // alt-screen. best-effort: failures never block launch.
    maybe_upgrade_config();

    // install a panic hook that routes panics to tracing instead of
    // stderr. background threads (notably `freqhole-rodio`) panic
    // inside rodio's symphonia decoder on malformed inputs; the
    // default hook writes the panic message + backtrace to stderr,
    // which lands directly inside the alt-screen and corrupts the
    // tui (e.g. printing decoder gibberish onto the player seek
    // bar). we still log the full panic via tracing for diagnosis
    // and only suppress the stderr output. color_eyre's hook
    // installed at binary entry is preserved for the main thread.
    install_tui_panic_hook();
    let terminal = ratatui::init();
    let mut stdout = std::io::stdout();
    let _ = crossterm::execute!(stdout, crossterm::event::EnableBracketedPaste);
    // request the most useful kitty protocol flags. ignore errors:
    // terminals that don't grok this just continue with the legacy
    // wire format.
    use crossterm::event::{KeyboardEnhancementFlags, PushKeyboardEnhancementFlags};
    let _ = crossterm::execute!(
        stdout,
        PushKeyboardEnhancementFlags(
            KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES
                | KeyboardEnhancementFlags::REPORT_ALTERNATE_KEYS
                | KeyboardEnhancementFlags::REPORT_ALL_KEYS_AS_ESCAPE_CODES
        )
    );
    // surface a one-time stderr-style hint inside the tui (via the
    // shared status line) for users on terminals known to swallow
    // ctrl modifiers, so the tui doesn't feel "broken" silently.
    if let Some(msg) = terminal_quirks_warning() {
        // stash in env-var-like channel: pass via LaunchOpts addition.
        // simplest path: print to log; the tui surfaces it on first
        // draw via a dedicated banner once we wire it. for now log it
        // so it's at least diagnosable.
        tracing::warn!(target: "rathole::tty", "{msg}");
    }
    let result = run::run(terminal, opts).await;
    // best-effort pop kbd flags + disable bracketed paste before
    // restoring the screen.
    let _ = crossterm::execute!(stdout, crossterm::event::PopKeyboardEnhancementFlags);
    let _ = crossterm::execute!(stdout, crossterm::event::DisableBracketedPaste);
    ratatui::restore();
    result
}

/// upgrade the resolved freqhole-config.toml in place if its
/// `server.version` differs from this binary's grimoire version.
/// silent and best-effort: all outcomes go to tracing so they end
/// up in `<data_dir>/rathole.log` instead of scribbling on the
/// alt-screen. assumes `grimoire::config::init_config` has already
/// run (both rathole entry points do this before calling `run`).
fn maybe_upgrade_config() {
    let Some(config_path) = grimoire::config::get_config_path() else {
        tracing::warn!(target: "rathole::config", "no config path resolved; skipping upgrade check");
        return;
    };
    match grimoire::config::config_needs_upgrade(&config_path) {
        Ok(false) => {}
        Ok(true) => match grimoire::config::upgrade_config(&config_path) {
            Ok(result) => {
                tracing::info!(
                    target: "rathole::config",
                    old = %result.old_version,
                    new = %result.new_version,
                    backup = %result.backup_path.display(),
                    "freqhole-config.toml upgraded"
                );
                // reload in-memory CONFIG so the current process sees
                // the new version without requiring a restart.
                if let Err(e) = grimoire::config::init_config(Some(config_path.clone())) {
                    tracing::warn!(target: "rathole::config", error = %e, "reload after upgrade failed");
                }
            }
            Err(e) => {
                tracing::warn!(target: "rathole::config", error = %e, "config upgrade failed");
            }
        },
        Err(e) => {
            tracing::warn!(target: "rathole::config", error = %e, "config upgrade check failed");
        }
    }
}

/// install a tui-safe panic hook. routes the panic message and
/// thread name to tracing (which goes to `<data_dir>/rathole.log`)
/// instead of stderr. the main-thread panic still aborts the
/// process via the default behaviour at the end of the chain so
/// `Result::Err` semantics aren't masked.
fn install_tui_panic_hook() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let name = thread.name().unwrap_or("<unnamed>").to_string();
        let location = info.location().map(|l| format!("{l}")).unwrap_or_default();
        let payload: &str = if let Some(s) = info.payload().downcast_ref::<&'static str>() {
            s
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.as_str()
        } else {
            "<non-string panic payload>"
        };
        tracing::error!(
            target: "rathole::panic",
            thread = %name,
            location = %location,
            payload = %payload,
            "panic intercepted by tui hook"
        );
        // for non-rodio background-thread panics, still defer to the
        // previous (color_eyre) hook so backtraces land in the log.
        // the rodio thread is special-cased: its panics are recovered
        // via catch_unwind in load_source(), and chaining the prev
        // hook would re-print a long backtrace that color_eyre tries
        // to send to stderr.
        if name != "freqhole-rodio" {
            prev(info);
        }
    }));
}

/// detect known-quirky terminals via $TERM_PROGRAM and return a
/// short human-readable explainer, or None if the terminal is
/// expected to behave well. used to seed the tui status line so
/// users on macos Terminal.app aren't left wondering why ctrl-m
/// behaves like Enter.
fn terminal_quirks_warning() -> Option<String> {
    let prog = std::env::var("TERM_PROGRAM").ok()?;
    match prog.as_str() {
        "Apple_Terminal" => Some(
            "macos Terminal.app collapses ctrl-m=Enter, ctrl-i=Tab, \
             ctrl-h=Backspace. use bare-letter shortcuts (m/r/p) on \
             the landing screen, or switch to ghostty/iterm2/wezterm \
             /kitty for the full keymap."
                .into(),
        ),
        _ => None,
    }
}
