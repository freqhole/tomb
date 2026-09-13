//! process-global "is this instance currently acting as a player"
//! flag, read by `server_info()` (the public `/api/hello` handler) so
//! it can report `player_device` without grimoire needing any
//! knowledge of rathole/charnel's own runtime types. mirrors the
//! existing `federation::p2p_client` "global slot set by whoever
//! hosts it, read by whoever needs it" pattern.
//!
//! deliberately NOT a touch/idle-timeout: "is this a player right
//! now" is a direct, current-truth boolean the host sets whenever its
//! own player-mode state changes (permanent once true for an explicit
//! `--player`-style launch, otherwise mirroring whichever view/route
//! is currently focused/mounted) - see
//! docs/rathole-pairing-invite-code-plan.md for the design discussion
//! that led here (a decaying idle timer was considered and rejected
//! as unnecessary complexity, since every real host already has a
//! direct boolean for "is my player view open" it can just report).

use std::sync::atomic::{AtomicBool, Ordering};

static ACTIVE: AtomicBool = AtomicBool::new(false);

/// set whether this process currently counts as an active player.
/// hosts call this with the current truth whenever it changes (e.g.
/// every tick with `focus == PlayerPairing`, or once at startup for a
/// permanent `--player` launch) - there's no decay/timeout to manage.
pub fn set_active(active: bool) {
    ACTIVE.store(active, Ordering::Relaxed);
}

/// true if this process currently counts as an active player.
pub fn is_active() -> bool {
    ACTIVE.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // the global is process-wide, so serialize tests that touch it.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn defaults_to_inactive_and_reflects_set_active() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        set_active(false);
        assert!(!is_active());
        set_active(true);
        assert!(is_active());
        set_active(false);
        assert!(!is_active());
    }
}
