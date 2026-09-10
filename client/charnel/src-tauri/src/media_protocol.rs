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
//! registered for every platform (harmless no-op unless something actually
//! requests via this scheme), but only actually USED client-side on
//! android for now - see `client/spume/src/music/services/storage/
//! localAudio.ts` / `localVideo.ts` and `CharnelLocalTransport.ts`'s
//! `resolveCharnelMediaSrc`. other platforms keep using tauri's built-in
//! `asset://`/`http://asset.localhost` protocol unchanged.

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
    match get_response(request) {
        Ok(response) => response,
        Err(status) => Response::builder()
            .status(status)
            .body(Cow::Borrowed(&[][..]))
            .unwrap(),
    }
}

fn get_response(request: Request<Vec<u8>>) -> Result<Response<Cow<'static, [u8]>>, StatusCode> {
    // skip leading `/`
    let raw_path = &request.uri().path()[1..];
    let path = percent_encoding::percent_decode_str(raw_path)
        .decode_utf8()
        .map_err(|_| StatusCode::BAD_REQUEST)?
        .to_string();

    // this scheme is only ever hit with paths this app itself generated
    // (from already-validated backend responses - synced media file paths),
    // not arbitrary user input, but still guard against directory traversal
    // and reject anything that isn't a plain, existing file.
    let canonical = std::fs::canonicalize(&path).map_err(|_| StatusCode::NOT_FOUND)?;
    if !canonical.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }

    let mut file = File::open(&canonical).map_err(|_| StatusCode::NOT_FOUND)?;
    let len = file
        .metadata()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .len();

    let mime_type = mime_guess::from_path(&canonical)
        .first_raw()
        .unwrap_or("application/octet-stream");

    let mut resp = Response::builder()
        .header(CONTENT_TYPE, mime_type)
        .header(ACCEPT_RANGES, "bytes");

    let range_header = request.headers().get("range").and_then(|r| r.to_str().ok());

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
        Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(CONTENT_RANGE, format!("bytes */{len}"))
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
