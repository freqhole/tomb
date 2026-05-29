//! task-scoped progress reporting for long-running admin handlers.
//!
//! callers (rathole's `spawn_admin_dispatch`) create an unbounded
//! channel and wrap the handler future in `scope(sender, fut)`. any
//! handler running inside that scope can call `report(line)` to push
//! a progress line back to the ui. handlers that don't care can just
//! ignore the helper — `report` is a no-op when no sender is set.

use tokio::sync::mpsc::UnboundedSender;

tokio::task_local! {
    static PROGRESS_SENDER: UnboundedSender<String>;
}

/// run `fut` with `sender` available as the task-local progress sink
/// for any `report` calls inside.
pub async fn scope<F, T>(sender: UnboundedSender<String>, fut: F) -> T
where
    F: std::future::Future<Output = T>,
{
    PROGRESS_SENDER.scope(sender, fut).await
}

/// push a progress line to the current task's progress sink, if any.
/// no-op when called outside a `scope(...)`.
pub fn report(line: impl Into<String>) {
    let _ = PROGRESS_SENDER.try_with(|tx| {
        let _ = tx.send(line.into());
    });
}
