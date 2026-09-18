//! custom `freqhole-media://` uri scheme protocol - serves local audio/
//! video/image files with full http range support, no artificial per-
//! request size cap.
//!
//! tauri's own built-in `asset` protocol (`tauri::protocol::asset`) caps
//! every single range response to `MAX_LEN = 1000 * 1024` (~1MB) bytes,
//! regardless of what was actually requested - confirmed (via a live
//! android chrome://inspect network trace) to truncate a 14MB mp3's
//! `Range: bytes=0-` request down to exactly 1,024,000 bytes. android's
//! webview media pipeline doesn't reliably recover from that truncation
//! (plays for ~30s, then stalls/restarts/errors depending on bitrate).
//! this handler mirrors the built-in one's shape but removes that cap and
//! always advertises `Accept-Ranges: bytes` (the built-in one only does so
//! when the incoming request already had a `Range` header).
//!
//! registered for every platform and now actually USED on every platform
//! too (previously android-only) - see `client/spume/src/music/services/
//! storage/localAudio.ts` / `localVideo.ts` and `CharnelLocalTransport.ts`'s
//! `resolveCharnelMediaSrc`. tauri's built-in `asset://`/`http://
//! asset.localhost` protocol is no longer used by this app's own media
//! playback at all.

use http_range::HttpRange;
use std::borrow::Cow;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use tauri::http::{header::*, status::StatusCode, Request, Response};
use tauri::UriSchemeContext;
use tauri::Wry;

pub const SCHEME: &str = "freqhole-media";

pub fn handler(
    _ctx: UriSchemeContext<'_, Wry>,
    request: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    // a panic in here would otherwise cross the app callback boundary
    // with no guarantee of a trace (media error 4 investigation - "the
    // handler is never invoked" and "the handler panicked before its
    // first log line" would look identical from the js side otherwise).
    let uri_for_panic_log = request.uri().to_string();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| get_response(request)));
    match result {
        Ok(Ok(response)) => response,
        Ok(Err(status)) => Response::builder()
            .status(status)
            .body(Cow::Borrowed(&[][..]))
            .unwrap(),
        Err(panic_payload) => {
            let panic_msg = panic_payload
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| panic_payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "<non-string panic payload>".to_string());
            tracing::error!(uri = %uri_for_panic_log, panic = %panic_msg, "freqhole-media: handler panicked");
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Cow::Borrowed(&[][..]))
                .unwrap()
        }
    }
}

fn get_response(request: Request<Vec<u8>>) -> Result<Response<Cow<'static, [u8]>>, StatusCode> {
    // skip leading `/`
    let raw_path = &request.uri().path()[1..];
    let path = percent_encoding::percent_decode_str(raw_path)
        .decode_utf8()
        .map_err(|_| {
            tracing::warn!(
                raw_path,
                "freqhole-media: failed to percent-decode request path"
            );
            StatusCode::BAD_REQUEST
        })?
        .to_string();

    let range_header = request.headers().get("range").and_then(|r| r.to_str().ok());

    // this scheme is only ever hit with paths this app itself generated
    // (from already-validated backend responses - synced media file paths),
    // not arbitrary user input, but still guard against directory traversal
    // and reject anything that isn't a plain, existing file.
    let canonical = std::fs::canonicalize(&path).map_err(|e| {
        tracing::warn!(path = %path, error = %e, "freqhole-media: canonicalize failed (file missing?)");
        StatusCode::NOT_FOUND
    })?;
    if !canonical.is_file() {
        tracing::warn!(path = %path, "freqhole-media: canonicalized path is not a regular file");
        return Err(StatusCode::NOT_FOUND);
    }

    let mut file = File::open(&canonical).map_err(|e| {
        tracing::warn!(path = %path, error = %e, "freqhole-media: failed to open file");
        StatusCode::NOT_FOUND
    })?;
    let len = file
        .metadata()
        .map_err(|e| {
            tracing::warn!(path = %path, error = %e, "freqhole-media: failed to read file metadata");
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .len();

    // extension alone is unreliable here: some already-imported files still
    // carry a generic `.bin` placeholder extension left over from before
    // their real one was ever re-derived from a sniffed mime type (see
    // `detect_extension`'s own callers) - `mime_guess::from_path` silently
    // falls back to `application/octet-stream` for those, and linux
    // (webkitgtk) / windows (webview2) both refuse to even attempt playing
    // an `<audio>`/`<video>` source whose Content-Type doesn't look like
    // media (confirmed live: `NotSupportedError`/media error code 4 for a
    // perfectly valid mp3 served with a `.bin` extension). sniff magic
    // bytes the same way the upload/pull path already does, instead of
    // trusting the extension alone.
    let mut peek_buf = vec![0u8; 4096.min(len as usize)];
    file.read_exact(&mut peek_buf).map_err(|e| {
        tracing::warn!(path = %path, error = %e, "freqhole-media: failed to read header bytes for mime sniffing");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    file.seek(SeekFrom::Start(0)).map_err(|e| {
        tracing::warn!(path = %path, error = %e, "freqhole-media: failed to seek back to start after sniffing");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let mime_type = grimoire::offal::upload::mime::detect_media_mime_type(&path, &peek_buf);

    let mut resp = Response::builder()
        .header(CONTENT_TYPE, mime_type)
        .header(ACCEPT_RANGES, "bytes")
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*");

    let Some(range_header) = range_header else {
        // no range requested - serve the whole file in one response.
        let mut buf = Vec::with_capacity(len as usize);
        file.read_to_end(&mut buf)
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        resp = resp.header(CONTENT_LENGTH, len);
        return resp
            .body(Cow::Owned(buf))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
    };

    resp = resp.header(ACCESS_CONTROL_EXPOSE_HEADERS, "content-range");

    let not_satisfiable = || {
        tracing::warn!(path = %path, len, range = ?range_header, "freqhole-media: range not satisfiable");
        Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(CONTENT_RANGE, format!("bytes */{len}"))
            .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(Cow::Borrowed(&[][..]))
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
    };

    let ranges = match HttpRange::parse(range_header, len) {
        Ok(ranges) => ranges
            .iter()
            .map(|r| (r.start, r.start + r.length - 1))
            .collect::<Vec<_>>(),
        Err(_) => return not_satisfiable(),
    };

    // single-range requests are the only shape any of our own audio/video/
    // image callers ever issue - no MAX_LEN cap, no multipart/byteranges
    // handling (unlike tauri's built-in asset protocol): serve exactly
    // what was asked for, in full.
    let &(start, end) = match ranges.first() {
        Some(r) if ranges.len() == 1 => r,
        _ => return not_satisfiable(),
    };

    if start >= len || end >= len || end < start {
        return not_satisfiable();
    }

    let nbytes = end + 1 - start;
    let mut buf = Vec::with_capacity(nbytes as usize);
    file.seek(SeekFrom::Start(start))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    file.take(nbytes)
        .read_to_end(&mut buf)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    resp = resp.header(CONTENT_RANGE, format!("bytes {start}-{end}/{len}"));
    resp = resp.header(CONTENT_LENGTH, buf.len());
    resp = resp.status(StatusCode::PARTIAL_CONTENT);
    resp.body(Cow::Owned(buf))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}
