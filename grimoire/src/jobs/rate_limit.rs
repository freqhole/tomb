//! global, process-wide rate limiters per external enrichment source.
//!
//! each external client (musicbrainz, last.fm, theaudiodb) shares a single
//! long-lived `reqwest::Client` instance and delegates all rate-limiting to
//! this module. processors must call `acquire(Source::...)` before each http
//! request; the clients themselves do not impose per-instance limits.
//!
//! conservative defaults:
//! - mb     : 1 r/s (musicbrainz hard requirement)
//! - lastfm : 5 r/s
//! - audiodb: 2 r/s
//!
//! usage:
//! ```ignore
//! use crate::jobs::rate_limit::{acquire, Source};
//! acquire(Source::Mb).await;
//! let r = client.get_release(&rid).await?;
//! ```

use crate::music::musicbrainz::rate_limiter::RateLimiter;
use std::sync::OnceLock;
use std::time::Duration;

/// which external source the gate applies to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Source {
    Mb,
    Lastfm,
    Audiodb,
}

fn mb_limiter() -> &'static RateLimiter {
    static LIM: OnceLock<RateLimiter> = OnceLock::new();
    LIM.get_or_init(|| RateLimiter::new(Duration::from_millis(1000)))
}

fn lastfm_limiter() -> &'static RateLimiter {
    static LIM: OnceLock<RateLimiter> = OnceLock::new();
    LIM.get_or_init(|| RateLimiter::new(Duration::from_millis(200)))
}

fn audiodb_limiter() -> &'static RateLimiter {
    static LIM: OnceLock<RateLimiter> = OnceLock::new();
    LIM.get_or_init(|| RateLimiter::new(Duration::from_millis(500)))
}

fn limiter_for(source: Source) -> &'static RateLimiter {
    match source {
        Source::Mb => mb_limiter(),
        Source::Lastfm => lastfm_limiter(),
        Source::Audiodb => audiodb_limiter(),
    }
}

/// block until it's safe to make the next request against `source`, then
/// mark the request as in-flight.
pub async fn acquire(source: Source) {
    limiter_for(source).wait_if_needed().await;
}
