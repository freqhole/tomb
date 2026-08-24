//! shared ffmpeg invocation helper
//!
//! small, generic wrapper around spawning ffmpeg with a config-provided arg
//! template: split the template, substitute placeholders, run, check the
//! exit code. mirrors the style already used by `blob_data::helpers`'s
//! per-purpose ffmpeg invocations (album art / waveform extraction), just
//! factored out for video's new call sites (poster/subtitle extraction,
//! transcoding). the existing audio/radio call sites are left as-is.

use crate::error::GrimoireError;
use std::process::Stdio;
use std::time::Duration;

/// run ffmpeg with `args_template`, substituting every `(placeholder, value)`
/// pair in `substitutions` before splitting into argv. returns an error if
/// the args can't be parsed, the process can't be spawned, it times out, or
/// it exits non-zero.
pub async fn run_ffmpeg(
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

    let output = tokio::time::timeout(Duration::from_secs(1800), cmd.output())
        .await
        .map_err(|_| GrimoireError::ProcessingFailed {
            message: "ffmpeg command timed out".to_string(),
        })?
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to run ffmpeg: {}", e),
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(GrimoireError::ProcessingFailed {
            message: format!(
                "ffmpeg failed. exit code: {:?}. error: {}",
                output.status.code(),
                stderr
            ),
        });
    }

    Ok(())
}
