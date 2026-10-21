//! event-triggered library-source reconciliation, owned by the job processor.

use std::time::Duration;
use tokio::{sync::watch, time::Instant};
use tokio_util::sync::CancellationToken;

static MONITOR_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
const DEBOUNCE: Duration = Duration::from_millis(250);
const SETTLE_DELAYS: [Duration; 2] = [Duration::from_secs(2), Duration::from_secs(4)];

pub(crate) async fn run(cancellation: CancellationToken) {
    if !cfg!(any(
        target_os = "linux",
        target_os = "macos",
        target_os = "windows"
    )) {
        return;
    }
    let Ok(_guard) = MONITOR_LOCK.try_lock() else {
        tracing::debug!("library source monitor already running");
        return;
    };
    let events = match super::events::subscribe() {
        Ok(events) => events,
        Err(error) => {
            tracing::error!(%error, "could not start library source notifications");
            return;
        }
    };
    monitor(cancellation, events, |startup| async move {
        let pool = crate::database::connect().await?;
        super::availability::reconcile(&pool, startup).await?;
        crate::GrimoireResult::Ok(())
    })
    .await;
}

async fn monitor<F, Fut>(
    cancellation: CancellationToken,
    mut events: watch::Receiver<u64>,
    mut refresh: F,
) where
    F: FnMut(bool) -> Fut,
    Fut: std::future::Future<Output = crate::GrimoireResult<()>>,
{
    let mut startup = true;
    let mut failures = 0u32;
    let mut followup = 0;
    let mut deadline = Some(Instant::now());
    loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            _ = async {
                match deadline {
                    Some(deadline) => tokio::time::sleep_until(deadline).await,
                    None => std::future::pending().await,
                }
            } => {
                let result = tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => return,
                    result = refresh(startup) => result,
                };
                match result {
                    Ok(()) => {
                        startup = false;
                        failures = 0;
                        // two bounded checks allow automount/udev to settle and
                        // cross the five-second absence threshold, then go idle.
                        deadline = SETTLE_DELAYS.get(followup).map(|delay| Instant::now() + *delay);
                        followup += 1;
                    }
                    Err(error) => {
                        tracing::warn!(%error, "library source reconciliation failed; preserving last known state");
                        failures = (failures + 1).min(5);
                        deadline = Some(Instant::now() + Duration::from_secs((1u64 << failures).min(30)));
                    }
                }
            }
            result = events.changed() => {
                if result.is_err() {
                    tracing::error!("storage notification channel closed; source monitor stopped");
                    return;
                }
                // keep an existing earlier deadline so event bursts cannot starve
                // reconciliation or postpone disconnect confirmation forever.
                let next = Instant::now() + DEBOUNCE;
                deadline = Some(deadline.map_or(next, |current| current.min(next)));
                followup = 0;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    async fn advance(seconds: u64) {
        tokio::time::advance(Duration::from_secs(seconds)).await;
        tokio::task::yield_now().await;
    }

    fn start(
        failures: usize,
    ) -> (
        watch::Sender<u64>,
        CancellationToken,
        Arc<Mutex<Vec<(bool, Instant)>>>,
        tokio::task::JoinHandle<()>,
    ) {
        let (sender, events) = watch::channel(0);
        let cancellation = CancellationToken::new();
        let calls = Arc::new(Mutex::new(Vec::new()));
        let observed = calls.clone();
        let handle = tokio::spawn(monitor(cancellation.clone(), events, move |startup| {
            let mut calls = observed.lock().unwrap();
            calls.push((startup, Instant::now()));
            let fail = calls.len() <= failures;
            async move {
                if fail {
                    Err(std::io::Error::other("temporary probe failure").into())
                } else {
                    Ok(())
                }
            }
        }));
        (sender, cancellation, calls, handle)
    }

    #[tokio::test(start_paused = true)]
    async fn settles_startup_then_stays_idle_until_notified() {
        let (sender, cancellation, calls, handle) = start(0);
        tokio::task::yield_now().await;
        assert_eq!(calls.lock().unwrap().len(), 1);
        advance(2).await;
        advance(4).await;
        assert_eq!(calls.lock().unwrap().len(), 3);
        advance(3600).await;
        assert_eq!(calls.lock().unwrap().len(), 3);
        sender.send_modify(|n| *n += 1);
        tokio::task::yield_now().await;
        tokio::time::advance(DEBOUNCE).await;
        tokio::task::yield_now().await;
        advance(2).await;
        advance(4).await;
        let observations = calls.lock().unwrap().clone();
        assert_eq!(observations.len(), 6);
        assert!(observations[0].0);
        assert!(observations[1..].iter().all(|(startup, _)| !startup));
        assert!(observations[5].1.duration_since(observations[3].1) >= Duration::from_secs(5));
        advance(3600).await;
        assert_eq!(calls.lock().unwrap().len(), 6);
        cancellation.cancel();
        handle.await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn bursts_coalesce_and_later_mount_events_start_a_new_bounded_window() {
        let (sender, cancellation, calls, handle) = start(0);
        tokio::task::yield_now().await;
        advance(2).await;
        advance(4).await;
        for _ in 0..20 {
            sender.send_modify(|n| *n += 1);
        }
        tokio::task::yield_now().await;
        tokio::time::advance(DEBOUNCE).await;
        tokio::task::yield_now().await;
        assert_eq!(calls.lock().unwrap().len(), 4);
        advance(2).await;
        advance(4).await;
        advance(120).await;
        assert_eq!(calls.lock().unwrap().len(), 6);
        sender.send_modify(|n| *n += 1);
        tokio::task::yield_now().await;
        tokio::time::advance(DEBOUNCE).await;
        tokio::task::yield_now().await;
        assert_eq!(calls.lock().unwrap().len(), 7);
        cancellation.cancel();
        handle.await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn retries_failed_startup_without_claiming_absence_then_goes_idle() {
        let (_sender, cancellation, calls, handle) = start(2);
        tokio::task::yield_now().await;
        advance(2).await;
        advance(4).await;
        advance(2).await;
        advance(4).await;
        assert_eq!(
            calls
                .lock()
                .unwrap()
                .iter()
                .map(|(startup, _)| *startup)
                .collect::<Vec<_>>(),
            [true, true, true, false, false]
        );
        advance(3600).await;
        assert_eq!(calls.lock().unwrap().len(), 5);
        cancellation.cancel();
        handle.await.unwrap();
    }

    #[tokio::test]
    async fn cancellation_drops_an_in_flight_probe() {
        let token = CancellationToken::new();
        let stop = token.clone();
        let (_sender, events) = watch::channel(0);
        let run = monitor(token, events, move |_| {
            stop.cancel();
            std::future::pending()
        });
        tokio::time::timeout(Duration::from_secs(1), run)
            .await
            .unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn notifications_during_a_probe_are_not_lost() {
        let (sender, events) = watch::channel(0);
        let token = CancellationToken::new();
        let calls = Arc::new(Mutex::new(0));
        let observed = calls.clone();
        let handle = tokio::spawn(monitor(token.clone(), events, move |_| {
            let mut count = observed.lock().unwrap();
            *count += 1;
            if *count == 1 {
                sender.send_modify(|n| *n += 1);
            }
            async { Ok(()) }
        }));
        tokio::task::yield_now().await;
        assert_eq!(*calls.lock().unwrap(), 1);
        tokio::time::advance(DEBOUNCE).await;
        tokio::task::yield_now().await;
        assert_eq!(*calls.lock().unwrap(), 2);
        token.cancel();
        handle.await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn cancellation_while_idle_stops_without_another_probe() {
        let (_sender, cancellation, calls, handle) = start(0);
        tokio::task::yield_now().await;
        advance(2).await;
        advance(4).await;
        cancellation.cancel();
        handle.await.unwrap();
        assert_eq!(calls.lock().unwrap().len(), 3);
    }
}
