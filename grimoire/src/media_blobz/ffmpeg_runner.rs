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

/// shared per-operation timeout. not yet configurable per-call (transcode
/// vs poster/waveform/subtitle extraction all share this one value) - a
/// legitimate large/4k transcode can be slow, so this is generous, but a
/// future pass could plumb a per-operation override through if that turns
/// out to matter in practice.
const FFMPEG_TIMEOUT: Duration = Duration::from_secs(30 * 60);

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
pub async fn run_ffmpeg(
    operation: &str,
    args_template: &str,
    substitutions: &[(&str, &str)],
    ffmpeg_path: &str,
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
    cmd.args(&args).stdout(Stdio::null()).stderr(Stdio::piped());

    let output = tokio::time::timeout(FFMPEG_TIMEOUT, cmd.output())
        .await
        .map_err(|_| GrimoireError::ProcessingFailed {
            message: format!(
                "{} timed out after {} minutes",
                operation,
                FFMPEG_TIMEOUT.as_secs() / 60
            ),
        })?
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to run ffmpeg for {}: {}", operation, e),
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GrimoireError::ProcessingFailed {
            message: format!("{} failed: {}", operation, humanize_ffmpeg_error(&stderr)),
        });
    }

    Ok(())
}
