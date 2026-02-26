//! dual cookie middleware for "auto" session_cookie_mode
//!
//! sets two session cookies with different SameSite policies:
//! - `freqhole_session_{server_id}` with SameSite=Lax (for HTTP same-site)
//! - `__Secure-freqhole_session_{server_id}` with SameSite=None + Secure (for HTTPS cross-site)
//!
//! the server_id in the cookie name prevents session conflicts when running
//! multiple freqhole servers on the same domain (e.g., localhost with different ports).
//!
//! this allows browser authentication to work in both HTTP dev environments
//! and HTTPS cross-site production deployments.

use axum::{
    body::Body,
    http::{header, Request, Response},
};
use futures_util::future::BoxFuture;
use std::sync::Arc;
use std::task::{Context, Poll};
use tower::{Layer, Service};

/// base cookie name prefix
const COOKIE_PREFIX: &str = "freqhole";
/// secure cookie name prefix
const SECURE_COOKIE_PREFIX: &str = "__Secure-freqhole";

/// generate main cookie name for a server
pub fn main_cookie_name(server_id: &str) -> String {
    format!("{}_{}", COOKIE_PREFIX, server_id)
}

/// generate secure cookie name for a server
pub fn secure_cookie_name(server_id: &str) -> String {
    format!("{}_{}", SECURE_COOKIE_PREFIX, server_id)
}

/// layer that adds dual cookie support
#[derive(Clone)]
pub struct DualCookieLayer {
    server_id: Arc<String>,
}

impl DualCookieLayer {
    pub fn new(server_id: impl Into<String>) -> Self {
        Self {
            server_id: Arc::new(server_id.into()),
        }
    }
}

impl<S> Layer<S> for DualCookieLayer {
    type Service = DualCookieMiddleware<S>;

    fn layer(&self, inner: S) -> Self::Service {
        DualCookieMiddleware {
            inner,
            server_id: self.server_id.clone(),
        }
    }
}

/// middleware that manages dual session cookies
#[derive(Clone)]
pub struct DualCookieMiddleware<S> {
    inner: S,
    server_id: Arc<String>,
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
        let server_id = self.server_id.clone();

        Box::pin(async move {
            let main_name = main_cookie_name(&server_id);
            let secure_name = secure_cookie_name(&server_id);

            // before request: if secure cookie exists but main cookie doesn't,
            // inject the secure cookie's value as the main cookie so tower-sessions can read it
            maybe_inject_cookie(&mut request, &main_name, &secure_name);

            // process the request through the session layer
            let response = inner.call(request).await?;

            // after response: if main cookie was set, duplicate it as secure cookie
            let response = maybe_add_secure_cookie(response, &main_name, &secure_name);

            Ok(response)
        })
    }
}

/// check if the secure cookie exists and main cookie doesn't;
/// if so, copy the secure cookie's value to the main cookie header
fn maybe_inject_cookie(request: &mut Request<Body>, main_name: &str, secure_name: &str) {
    let cookie_header = match request.headers().get(header::COOKIE) {
        Some(h) => match h.to_str() {
            Ok(s) => s.to_string(),
            Err(_) => return,
        },
        None => return,
    };

    // check if main cookie already exists
    if cookie_header.contains(&format!("{}=", main_name)) {
        return;
    }

    // check if secure cookie exists and extract its value
    let secure_prefix = format!("{}=", secure_name);
    if let Some(start) = cookie_header.find(&secure_prefix) {
        let value_start = start + secure_prefix.len();
        let value_end = cookie_header[value_start..]
            .find(';')
            .map(|i| value_start + i)
            .unwrap_or(cookie_header.len());
        let session_value = &cookie_header[value_start..value_end];

        // add main cookie to the header
        let new_cookie = format!("{}; {}={}", cookie_header, main_name, session_value);
        if let Ok(new_header) = new_cookie.parse() {
            request.headers_mut().insert(header::COOKIE, new_header);
        }
    }
}

/// if the response sets the main cookie, add a duplicate secure cookie
fn maybe_add_secure_cookie(
    mut response: Response<Body>,
    main_name: &str,
    secure_name: &str,
) -> Response<Body> {
    // collect all set-cookie headers
    let set_cookies: Vec<_> = response
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .collect();

    // look for main cookie being set
    let main_prefix = format!("{}=", main_name);
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
            let secure_cookie = build_secure_cookie(session_value, cookie_str, secure_name);

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
fn build_secure_cookie(session_value: &str, original_cookie: &str, secure_name: &str) -> String {
    // start with the secure cookie name and value
    let mut parts = vec![format!("{}={}", secure_name, session_value)];

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
