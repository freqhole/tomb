//! dual cookie middleware for "auto" session_cookie_mode
//!
//! sets two session cookies with different SameSite policies:
//! - `freqhole_session` with SameSite=Lax (for HTTP same-site)
//! - `__Secure-freqhole_session` with SameSite=None + Secure (for HTTPS cross-site)
//!
//! this allows browser authentication to work in both HTTP dev environments
//! and HTTPS cross-site production deployments.

use axum::{
    body::Body,
    http::{header, Request, Response},
};
use futures_util::future::BoxFuture;
use std::task::{Context, Poll};
use tower::{Layer, Service};

/// main cookie name used by tower-sessions
pub const MAIN_COOKIE_NAME: &str = "freqhole_session";
/// secure cookie name for HTTPS cross-site
pub const SECURE_COOKIE_NAME: &str = "__Secure-freqhole_session";

/// layer that adds dual cookie support
#[derive(Clone)]
pub struct DualCookieLayer;

impl<S> Layer<S> for DualCookieLayer {
    type Service = DualCookieMiddleware<S>;

    fn layer(&self, inner: S) -> Self::Service {
        DualCookieMiddleware { inner }
    }
}

/// middleware that manages dual session cookies
#[derive(Clone)]
pub struct DualCookieMiddleware<S> {
    inner: S,
}

impl<S> Service<Request<Body>> for DualCookieMiddleware<S>
where
    S: Service<Request<Body>, Response = Response<Body>> + Send + Clone + 'static,
    S::Future: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = BoxFuture<'static, Result<Self::Response, Self::Error>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, mut request: Request<Body>) -> Self::Future {
        let mut inner = self.inner.clone();

        Box::pin(async move {
            // before request: if secure cookie exists but main cookie doesn't,
            // inject the secure cookie's value as the main cookie so tower-sessions can read it
            maybe_inject_cookie(&mut request);

            // process the request through the session layer
            let response = inner.call(request).await?;

            // after response: if main cookie was set, duplicate it as secure cookie
            let response = maybe_add_secure_cookie(response);

            Ok(response)
        })
    }
}

/// check if the secure cookie exists and main cookie doesn't;
/// if so, copy the secure cookie's value to the main cookie header
fn maybe_inject_cookie(request: &mut Request<Body>) {
    let cookie_header = match request.headers().get(header::COOKIE) {
        Some(h) => match h.to_str() {
            Ok(s) => s.to_string(),
            Err(_) => return,
        },
        None => return,
    };

    // check if main cookie already exists
    if cookie_header.contains(&format!("{}=", MAIN_COOKIE_NAME)) {
        return;
    }

    // check if secure cookie exists and extract its value
    let secure_prefix = format!("{}=", SECURE_COOKIE_NAME);
    if let Some(start) = cookie_header.find(&secure_prefix) {
        let value_start = start + secure_prefix.len();
        let value_end = cookie_header[value_start..]
            .find(';')
            .map(|i| value_start + i)
            .unwrap_or(cookie_header.len());
        let session_value = &cookie_header[value_start..value_end];

        // add main cookie to the header
        let new_cookie = format!("{}; {}={}", cookie_header, MAIN_COOKIE_NAME, session_value);
        if let Ok(new_header) = new_cookie.parse() {
            request.headers_mut().insert(header::COOKIE, new_header);
        }
    }
}

/// if the response sets the main cookie, add a duplicate secure cookie
fn maybe_add_secure_cookie(mut response: Response<Body>) -> Response<Body> {
    // collect all set-cookie headers
    let set_cookies: Vec<_> = response
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .collect();

    // look for main cookie being set
    let main_prefix = format!("{}=", MAIN_COOKIE_NAME);
    for cookie_str in &set_cookies {
        if cookie_str.starts_with(&main_prefix) {
            // extract the session ID value (everything between = and first ;)
            let value_start = main_prefix.len();
            let value_end = cookie_str[value_start..]
                .find(';')
                .map(|i| value_start + i)
                .unwrap_or(cookie_str.len());
            let session_value = &cookie_str[value_start..value_end];

            // build the secure cookie with SameSite=None and Secure
            // preserve path and expiry from original, but change name and add secure attributes
            let secure_cookie = build_secure_cookie(session_value, cookie_str);

            if let Ok(header_value) = secure_cookie.parse() {
                response
                    .headers_mut()
                    .append(header::SET_COOKIE, header_value);
            }
            break;
        }
    }

    response
}

/// build the secure cookie string from the session value and original cookie
fn build_secure_cookie(session_value: &str, original_cookie: &str) -> String {
    // start with the secure cookie name and value
    let mut parts = vec![format!("{}={}", SECURE_COOKIE_NAME, session_value)];

    // extract and preserve certain attributes from the original cookie
    let original_lower = original_cookie.to_lowercase();

    // preserve Path
    if let Some(path_idx) = original_lower.find("path=") {
        let path_start = path_idx + 5;
        let path_end = original_cookie[path_start..]
            .find(';')
            .map(|i| path_start + i)
            .unwrap_or(original_cookie.len());
        parts.push(format!("Path={}", &original_cookie[path_start..path_end]));
    } else {
        parts.push("Path=/".to_string());
    }

    // preserve Max-Age or Expires if present
    if let Some(max_age_idx) = original_lower.find("max-age=") {
        let max_age_start = max_age_idx + 8;
        let max_age_end = original_cookie[max_age_start..]
            .find(';')
            .map(|i| max_age_start + i)
            .unwrap_or(original_cookie.len());
        parts.push(format!(
            "Max-Age={}",
            &original_cookie[max_age_start..max_age_end]
        ));
    }

    // add required attributes for cross-site cookies
    parts.push("SameSite=None".to_string());
    parts.push("Secure".to_string());

    // always include HttpOnly
    parts.push("HttpOnly".to_string());

    parts.join("; ")
}
