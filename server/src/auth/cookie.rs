//! dynamic SameSite middleware for "auto" session_cookie_mode
//!
//! dynamically sets session cookie SameSite attribute based on request origin:
//! - HTTPS origins → SameSite=None; Secure (required for cross-origin)
//! - all other origins (http, tauri, freqhole, etc.) → SameSite=Lax

use axum::{
    body::Body,
    http::{header, Request, Response},
};
use futures_util::future::BoxFuture;
use std::task::{Context, Poll};
use tower::{Layer, Service};

/// sanitize server name for use as cookie name prefix.
/// cookie names can't contain: ( ) < > @ , ; : \ " / [ ] ? = { } space tab
/// converts to lowercase, replaces invalid chars with underscores, limits length
pub fn sanitize_cookie_name(server_name: &str) -> String {
    let sanitized: String = server_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();

    // collapse multiple underscores and trim
    let mut result = String::new();
    let mut last_was_underscore = false;
    for c in sanitized.chars() {
        if c == '_' {
            if !last_was_underscore {
                result.push(c);
            }
            last_was_underscore = true;
        } else {
            result.push(c);
            last_was_underscore = false;
        }
    }

    // limit length and trim underscores from edges
    let trimmed = result.trim_matches('_');
    let limited = if trimmed.len() > 32 {
        &trimmed[..32]
    } else {
        trimmed
    };

    // fallback if empty
    if limited.is_empty() {
        "session".to_string()
    } else {
        format!("{}_session", limited)
    }
}

/// layer that adds dynamic SameSite support
#[derive(Clone)]
pub struct DynamicSameSiteLayer {
    enabled: bool,
    cookie_name: String,
}

impl DynamicSameSiteLayer {
    pub fn new(enabled: bool, cookie_name: String) -> Self {
        Self {
            enabled,
            cookie_name,
        }
    }
}

impl<S> Layer<S> for DynamicSameSiteLayer {
    type Service = DynamicSameSiteMiddleware<S>;

    fn layer(&self, inner: S) -> Self::Service {
        DynamicSameSiteMiddleware {
            inner,
            enabled: self.enabled,
            cookie_name: self.cookie_name.clone(),
        }
    }
}

/// middleware that dynamically sets SameSite based on origin
#[derive(Clone)]
pub struct DynamicSameSiteMiddleware<S> {
    inner: S,
    enabled: bool,
    cookie_name: String,
}

impl<S> Service<Request<Body>> for DynamicSameSiteMiddleware<S>
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

    fn call(&mut self, request: Request<Body>) -> Self::Future {
        let mut inner = self.inner.clone();
        let enabled = self.enabled;
        let cookie_name = self.cookie_name.clone();

        // extract origin to determine if HTTPS
        let is_https = request
            .headers()
            .get(header::ORIGIN)
            .and_then(|v| v.to_str().ok())
            .map(|origin| origin.starts_with("https://"))
            .unwrap_or(false);

        Box::pin(async move {
            let response = inner.call(request).await?;

            // if disabled, just pass through
            if !enabled {
                return Ok(response);
            }

            Ok(rewrite_samesite(response, is_https, &cookie_name))
        })
    }
}

/// rewrite session cookie's SameSite attribute based on origin protocol
fn rewrite_samesite(
    mut response: Response<Body>,
    is_https: bool,
    cookie_name: &str,
) -> Response<Body> {
    // collect all Set-Cookie headers
    let set_cookies: Vec<_> = response
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .collect();

    if set_cookies.is_empty() {
        return response;
    }

    // remove existing Set-Cookie headers
    response.headers_mut().remove(header::SET_COOKIE);

    // process each cookie
    let cookie_prefix = format!("{}=", cookie_name);
    for cookie_str in set_cookies {
        let new_cookie = if cookie_str.starts_with(&cookie_prefix) {
            // this is our session cookie - rewrite SameSite
            rewrite_cookie_samesite(&cookie_str, is_https)
        } else {
            // not our cookie, pass through unchanged
            cookie_str
        };

        if let Ok(header_value) = new_cookie.parse() {
            response
                .headers_mut()
                .append(header::SET_COOKIE, header_value);
        }
    }

    response
}

/// rewrite a single cookie's SameSite attribute
fn rewrite_cookie_samesite(cookie: &str, is_https: bool) -> String {
    // parse cookie into parts
    let parts: Vec<&str> = cookie.split(';').map(|s| s.trim()).collect();
    if parts.is_empty() {
        return cookie.to_string();
    }

    // rebuild cookie with correct SameSite
    let mut new_parts: Vec<String> = Vec::new();
    let mut has_secure = false;

    for part in &parts {
        let lower = part.to_lowercase();

        // skip existing SameSite and Secure - we'll add the correct ones
        if lower.starts_with("samesite=") {
            continue;
        }
        if lower == "secure" {
            has_secure = true;
            if !is_https {
                // remove Secure for non-HTTPS
                continue;
            }
        }

        new_parts.push(part.to_string());
    }

    // add correct SameSite based on origin
    if is_https {
        new_parts.push("SameSite=None".to_string());
        if !has_secure {
            new_parts.push("Secure".to_string());
        }
    } else {
        new_parts.push("SameSite=Lax".to_string());
    }

    new_parts.join("; ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_cookie_name() {
        assert_eq!(sanitize_cookie_name("freqhole"), "freqhole_session");
        assert_eq!(sanitize_cookie_name("My Server"), "my_server_session");
        assert_eq!(sanitize_cookie_name("test@server!"), "test_server_session");
        assert_eq!(sanitize_cookie_name("  spaces  "), "spaces_session");
        assert_eq!(sanitize_cookie_name("___"), "session");
        assert_eq!(sanitize_cookie_name(""), "session");
        assert_eq!(sanitize_cookie_name("a-b_c"), "a-b_c_session");
        // test length limit
        let long_name = "a".repeat(50);
        let result = sanitize_cookie_name(&long_name);
        assert!(result.len() <= 40); // 32 + "_session"
    }

    #[test]
    fn test_rewrite_cookie_samesite_https() {
        let cookie = "test_session=abc123; Path=/; HttpOnly; SameSite=Lax";
        let result = rewrite_cookie_samesite(cookie, true);
        assert!(result.contains("SameSite=None"));
        assert!(result.contains("Secure"));
        assert!(!result.contains("SameSite=Lax"));
    }

    #[test]
    fn test_rewrite_cookie_samesite_http() {
        let cookie = "test_session=abc123; Path=/; HttpOnly; SameSite=None; Secure";
        let result = rewrite_cookie_samesite(cookie, false);
        assert!(result.contains("SameSite=Lax"));
        assert!(!result.contains("SameSite=None"));
        assert!(!result.contains("Secure"));
    }
}
