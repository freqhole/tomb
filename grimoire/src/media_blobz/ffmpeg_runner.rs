//! shared ffmpeg invocation helper
//!
//! small, generic wrapper around spawning ffmpeg with a config-provided arg
//! template: split the template, substitute placeholders, run, check the
//! exit code. mirrors the style already used by `blob_data::helpers`'s
//! per-purpose ffmpeg invocations (album art / waveform extraction), just
//! factored out for video's new call sites (poster/subtitle extraction,
//! transcoding). the existing audio/radio call sites are left as-is.
//!
//! stderr cleanup (`humanize_ffmpeg_error`) is centralized here so every
//! caller of `run_ffmpeg` gets a short, readable error message instead of
//! a raw 10-50KB ffmpeg banner/codec-list dump - callers don't need to
//! remember to humanize the result themselves.

use crate::error::GrimoireError;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;

/// idle timeout: reset every time ffmpeg writes anything new to stderr
/// (which it does periodically - by default every ~0.5-1s - via its own
/// progress stats line), not an overall cap on total run time. a
/// legitimate large/4k transcode can genuinely take well over 30 minutes
/// as long as it's still actively working; this only fires once ffmpeg
/// has gone fully silent (hung/stuck) for this long. hardcoded - not
/// worth a config knob for this.
const FFMPEG_IDLE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// minimum gap between `on_progress` callback invocations in `run_ffmpeg` -
/// ffmpeg's own stats line arrives every ~0.5-1s, far more often than any
/// job-progress UI needs.
const PROGRESS_MIN_INTERVAL: Duration = Duration::from_secs(2);

/// parse the LAST `time=HH:MM:SS.ss` stat ffmpeg printed in this chunk of
/// its stderr, if any - ffmpeg repeats the full stats line (`frame=...
/// time=... bitrate=...`) every time it flushes progress, so only the most
/// recent match in a given read is worth reporting.
fn parse_last_ffmpeg_time(buf: &[u8]) -> Option<Duration> {
    let text = String::from_utf8_lossy(buf);
    let last = text.rmatch_indices("time=").next()?.0;
    let rest = &text[last + "time=".len()..];
    let stamp = rest.split_whitespace().next()?;
    let mut parts = stamp.split(':');
    let hours: u64 = parts.next()?.parse().ok()?;
    let minutes: u64 = parts.next()?.parse().ok()?;
    let seconds: f64 = parts.next()?.parse().ok()?;
    if seconds.is_sign_negative() {
        return None; // ffmpeg prints "time=-00:00:00.00" before the first real stat
    }
    Some(Duration::from_secs_f64(
        (hours * 3600 + minutes * 60) as f64 + seconds,
    ))
}

/// turn a raw ffmpeg/ffprobe stderr blob into a short, human-readable
/// summary suitable for surfacing in the client's job-progress UI. the raw
/// text is often a multi-line tool banner plus a single relevant error line.
pub fn humanize_ffmpeg_error(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "unknown ffmpeg error".to_string();
    }
    // ffmpeg always prints a generic footer line ("Conversion failed!")
    // as the very last line of stderr on any encode/decode failure - the
    // actually useful message is 1-3 lines above it. skip footer/banner
    // noise and prefer the last remaining, specific-looking line.
    let is_uninformative = |l: &str| {
        let l = l.trim().to_lowercase();
        l.is_empty()
            || l == "conversion failed!"
            || l.starts_with("ffmpeg version")
            || l.starts_with("configuration:")
            || l.starts_with("libav")
            || l.starts_with("libsw")
            || l.starts_with("libpostproc")
            || l.starts_with("built with")
            || l.starts_with("press [q]")
            || l.starts_with("universal media converter usage")
            || l.starts_with("use -h to get full help")
    };
    let candidate = trimmed
        .lines()
        .rev()
        .find(|l| !is_uninformative(l))
        .unwrap_or_else(|| trimmed.lines().next_back().unwrap_or(trimmed))
        .trim();
    let lower = candidate.to_lowercase();
    if lower.contains("no such file or directory") {
        return "input file not found".to_string();
    }
    if lower.contains("invalid data found when processing input") {
        return "unrecognized or corrupt video file".to_string();
    }
    if lower.contains("does not contain any stream") || lower.contains("stream map") {
        return "no matching audio/video stream found".to_string();
    }
    if lower.contains("trailing option") {
        return "ffmpeg command had a syntax error (extra arguments after the output file) - check the configured ffmpeg args template".to_string();
    }
    if candidate.len() > 160 {
        format!("{}\u{2026}", &candidate[..157])
    } else {
        candidate.to_string()
    }
}

/// run ffmpeg with `args_template`, substituting every `(placeholder, value)`
/// pair in `substitutions` before splitting into argv. returns an error if
/// the args can't be parsed, the process can't be spawned, it times out, or
/// it exits non-zero. `operation` is a short human label (e.g. "poster
/// extraction", "transcode rendition 720p") included in any error message
/// so failures/timeouts are identifiable without needing to correlate logs.
///
/// `on_progress`, when given, is called with the elapsed encode time
/// ffmpeg itself reports (parsed from its own periodic `time=HH:MM:SS.ss`
/// stderr stats line) - throttled to at most once every `PROGRESS_MIN_INTERVAL`
/// so a caller wiring this into a job-progress event doesn't flood it.
/// `None` (the default for callers that don't need live progress, e.g. the
/// short poster/subtitle extractions) skips parsing entirely.
pub async fn run_ffmpeg(
    operation: &str,
    args_template: &str,
    substitutions: &[(&str, &str)],
    ffmpeg_path: &str,
    on_progress: Option<&(dyn Fn(Duration) + Send + Sync)>,
) -> Result<(), GrimoireError> {
    // parse the template into argv FIRST, then substitute placeholders
    // per-arg — substituting into the whole string before splitting would
    // let a value containing a space (e.g. a macOS data dir under
    // `~/Library/Application Support/...`) get torn into two argv
    // entries, truncating the path ffmpeg actually sees. mirrors the
    // pattern already used by blob_data::helpers's album art / waveform
    // extraction.
    let mut args =
        shell_words::split(args_template).map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to parse ffmpeg args: {}", e),
        })?;

    for arg in args.iter_mut() {
        for (placeholder, value) in substitutions {
            if arg.contains(placeholder) {
                *arg = arg.replace(placeholder, value);
            }
        }
    }

    let mut cmd = tokio::process::Command::new(ffmpeg_path);
    cmd.arg("-hide_banner")
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    crate::process_ext::hide_console_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| GrimoireError::ProcessingFailed {
        message: format!("failed to spawn ffmpeg for {}: {}", operation, e),
    })?;

    // read stderr incrementally instead of the one-shot `cmd.output()` -
    // ffmpeg writes a progress stats line to stderr roughly every
    // ~0.5-1s while actively encoding, so each successful read below is
    // proof of forward progress and resets the idle timer. only a real
    // stall (ffmpeg hung, or genuinely stuck) lets the timeout fire.
    let mut stderr_pipe = child.stderr.take().expect("stderr was piped");
    let mut stderr_buf = Vec::new();
    let mut chunk = [0u8; 4096];
    // how far into stderr_buf we've already scanned for a `time=` stat -
    // avoids re-parsing the whole (potentially multi-KB) buffer on every
    // single chunk read.
    let mut scanned_up_to = 0usize;
    let mut last_progress_at = std::time::Instant::now() - PROGRESS_MIN_INTERVAL;
    loop {
        match tokio::time::timeout(FFMPEG_IDLE_TIMEOUT, stderr_pipe.read(&mut chunk)).await {
            Ok(Ok(0)) => break, // EOF - ffmpeg closed stderr, process is exiting
            Ok(Ok(n)) => {
                stderr_buf.extend_from_slice(&chunk[..n]);
                if let Some(cb) = on_progress {
                    if last_progress_at.elapsed() >= PROGRESS_MIN_INTERVAL {
                        if let Some(elapsed) = parse_last_ffmpeg_time(&stderr_buf[scanned_up_to..])
                        {
                            cb(elapsed);
                            last_progress_at = std::time::Instant::now();
                        }
                    }
                    scanned_up_to = stderr_buf.len();
                }
            }
            Ok(Err(e)) => {
                let _ = child.kill().await;
                return Err(GrimoireError::ProcessingFailed {
                    message: format!("failed to read ffmpeg output for {}: {}", operation, e),
                });
            }
            Err(_) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err(GrimoireError::ProcessingFailed {
                    message: format!(
                        "{} timed out: no ffmpeg output for {} minutes",
                        operation,
                        FFMPEG_IDLE_TIMEOUT.as_secs() / 60
                    ),
                });
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to wait on ffmpeg for {}: {}", operation, e),
        })?;

    if !status.success() {
        let stderr = String::from_utf8_lossy(&stderr_buf);
        return Err(GrimoireError::ProcessingFailed {
            message: format!("{} failed: {}", operation, humanize_ffmpeg_error(&stderr)),
        });
    }

    Ok(())
}
