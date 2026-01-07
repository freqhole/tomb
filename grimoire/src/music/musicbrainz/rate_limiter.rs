//! Rate limiter for MusicBrainz API compliance
//!
//! Provides rate limiting functionality to ensure compliance with MusicBrainz
//! API guidelines (minimum 1 second between requests).

use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

/// Rate limiter for MusicBrainz API requests
#[derive(Debug, Clone)]
pub struct RateLimiter {
    /// Last request timestamp
    last_request: Arc<Mutex<Option<Instant>>>,

    /// Minimum interval between requests
    min_interval: Duration,
}

impl RateLimiter {
    /// Create a new rate limiter with specified interval
    pub fn new(min_interval: Duration) -> Self {
        Self {
            last_request: Arc::new(Mutex::new(None)),
            min_interval,
        }
    }

    /// Create a rate limiter with MusicBrainz default (1 second)
    pub fn musicbrainz_default() -> Self {
        Self::new(Duration::from_millis(1000))
    }

    /// Wait if needed to respect rate limit, then mark request as made
    pub async fn wait_if_needed(&self) {
        let mut last_request = self.last_request.lock().await;

        if let Some(last) = *last_request {
            let elapsed = last.elapsed();
            if elapsed < self.min_interval {
                let wait_time = self.min_interval - elapsed;
                tokio::time::sleep(wait_time).await;
            }
        }

        *last_request = Some(Instant::now());
    }

    /// Get the minimum interval duration
    pub fn min_interval(&self) -> Duration {
        self.min_interval
    }

    /// Reset the rate limiter (for testing)
    pub async fn reset(&self) {
        let mut last_request = self.last_request.lock().await;
        *last_request = None;
    }

    /// Check if we can make a request without waiting
    pub async fn can_proceed_immediately(&self) -> bool {
        let last_request = self.last_request.lock().await;

        match *last_request {
            Some(last) => last.elapsed() >= self.min_interval,
            None => true,
        }
    }

    /// Get time until next request is allowed
    pub async fn time_until_next_request(&self) -> Duration {
        let last_request = self.last_request.lock().await;

        match *last_request {
            Some(last) => {
                let elapsed = last.elapsed();
                if elapsed < self.min_interval {
                    self.min_interval - elapsed
                } else {
                    Duration::ZERO
                }
            }
            None => Duration::ZERO,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::sleep;

    #[tokio::test]
    async fn test_rate_limiter_creation() {
        let limiter = RateLimiter::new(Duration::from_millis(100));
        assert_eq!(limiter.min_interval(), Duration::from_millis(100));

        let mb_limiter = RateLimiter::musicbrainz_default();
        assert_eq!(mb_limiter.min_interval(), Duration::from_millis(1000));
    }

    #[tokio::test]
    async fn test_can_proceed_initially() {
        let limiter = RateLimiter::new(Duration::from_millis(100));
        assert!(limiter.can_proceed_immediately().await);
    }

    #[tokio::test]
    async fn test_rate_limiting_behavior() {
        let limiter = RateLimiter::new(Duration::from_millis(50));

        // First request should proceed immediately
        assert!(limiter.can_proceed_immediately().await);

        // Mark first request
        limiter.wait_if_needed().await;

        // Second request should be blocked
        assert!(!limiter.can_proceed_immediately().await);

        // Wait for rate limit to expire
        sleep(Duration::from_millis(60)).await;

        // Should be able to proceed now
        assert!(limiter.can_proceed_immediately().await);
    }

    #[tokio::test]
    async fn test_time_until_next_request() {
        let limiter = RateLimiter::new(Duration::from_millis(100));

        // No previous request
        assert_eq!(limiter.time_until_next_request().await, Duration::ZERO);

        // Mark a request
        limiter.wait_if_needed().await;

        // Should have some wait time
        let wait_time = limiter.time_until_next_request().await;
        assert!(wait_time > Duration::ZERO);
        assert!(wait_time <= Duration::from_millis(100));
    }

    #[tokio::test]
    async fn test_reset_functionality() {
        let limiter = RateLimiter::new(Duration::from_millis(100));

        // Make a request
        limiter.wait_if_needed().await;
        assert!(!limiter.can_proceed_immediately().await);

        // Reset the limiter
        limiter.reset().await;
        assert!(limiter.can_proceed_immediately().await);
    }

    #[tokio::test]
    async fn test_actual_wait_timing() {
        let limiter = RateLimiter::new(Duration::from_millis(50));

        let start = Instant::now();

        // First request
        limiter.wait_if_needed().await;

        // Second request should wait
        limiter.wait_if_needed().await;

        let elapsed = start.elapsed();

        // Should have waited at least the minimum interval
        assert!(elapsed >= Duration::from_millis(50));

        // But not too much longer (accounting for test timing variance)
        assert!(elapsed < Duration::from_millis(100));
    }
}
