//! a [`PlayerController`] that accepts every command and emits no
//! events. used by tests and by callers that need a player handle
//! before the real backend is wired up (e.g. headless cli paths).

use async_trait::async_trait;
use tokio::sync::broadcast;

use crate::error::GrimoireResult;

use super::control::{PlayerCommand, PlayerEvent, PlayerSnapshot};
use super::PlayerController;

/// a player controller that does nothing.
///
/// commands are dropped silently; the event channel is alive but
/// nothing is ever sent on it. [`Self::snapshot`] always returns
/// `PlayerSnapshot::default()`.
pub struct NoopPlayerController {
    tx: broadcast::Sender<PlayerEvent>,
}

impl NoopPlayerController {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(16);
        Self { tx }
    }
}

impl Default for NoopPlayerController {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl PlayerController for NoopPlayerController {
    async fn send(&self, _cmd: PlayerCommand) -> GrimoireResult<()> {
        Ok(())
    }

    fn subscribe(&self) -> broadcast::Receiver<PlayerEvent> {
        self.tx.subscribe()
    }

    fn snapshot(&self) -> PlayerSnapshot {
        PlayerSnapshot::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn noop_accepts_commands() {
        let p = NoopPlayerController::new();
        p.send(PlayerCommand::Play).await.expect("send ok");
        assert!(p.snapshot().state.is_none());
    }
}
