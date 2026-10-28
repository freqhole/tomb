//! decides whether a video track's source file can be stream-copied into
//! the radio's fragmented mp4 (`RadioConfig::video_copy_encode_args`)
//! instead of being re-encoded in real time.
//!
//! copying costs next to nothing, so it can never fall behind real time
//! the way a full libx264 re-encode can on a slow box. but `frag_keyframe`
//! can only cut fragments where the source already has keyframes, so the
//! source has to look like what the pacer and MSE clients expect: h264,
//! 4:2:0, and keyframes every few seconds. it also has to be light enough
//! to stream: no bigger than 1080p (long edge 1920) and no heavier than
//! the bitrate ceiling below - anything bigger falls back to the live
//! re-encode, which is a steady 2500k. the `compatible` rendition's
//! default args (3s keyframes, long edge capped at 1920, 4000k maxrate)
//! are tuned so every rendition passes.

use std::path::Path;
use std::time::Duration;

use serde_json::Value;
use tracing::{info, warn};

/// longest keyframe spacing still treated as stream-ready. the radio's
/// fragments are nominally 3s; anything past this makes chunks (and the
/// warm-up/catchup ring, which is sized in chunks) balloon.
pub const MAX_COPY_KEYFRAME_GAP_S: f64 = 6.0;

/// only the start of the file is inspected - enough to see the encoder's
/// keyframe cadence without reading a whole feature-length file.
const PROBE_WINDOW_S: u32 = 60;

const PROBE_TIMEOUT: Duration = Duration::from_secs(8);

/// longest frame edge still copied - 1080p landscape or portrait.
pub const MAX_COPY_LONG_EDGE: u32 = 1920;

/// highest average video bitrate (over the probe window) still copied.
/// the rendition maxrate (4000k) plus headroom for container overhead.
pub const MAX_COPY_VIDEO_KBPS: u32 = 4500;

/// a window shorter than this can't give a meaningful bitrate.
const MIN_BITRATE_SPAN_S: f64 = 2.0;

/// h264 profiles every MSE implementation decodes. 10-bit/4:2:2 "high"
/// variants are deliberately absent.
const COPYABLE_H264_PROFILES: &[&str] = &["Constrained Baseline", "Baseline", "Main", "High"];

#[derive(Debug, Clone, PartialEq)]
pub struct VideoStreamFacts {
    pub codec_name: String,
    pub pix_fmt: String,
    pub profile: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// average video bitrate over the probe window, when measurable.
    pub avg_kbps: Option<u32>,
    /// presentation times (seconds) of keyframe packets inside the window.
    pub keyframe_times: Vec<f64>,
    /// latest packet presentation time seen inside the window.
    pub last_packet_time: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CopyVerdict {
    Copy,
    ReEncode(String),
}

/// pulls the first video stream's facts out of
/// `ffprobe -show_entries stream=...:packet=pts_time,flags,size -of json`.
pub fn parse_ffprobe_json(json: &Value) -> Option<VideoStreamFacts> {
    let stream = json.get("streams")?.as_array()?.first()?;
    let codec_name = stream.get("codec_name")?.as_str()?.to_string();
    let pix_fmt = stream
        .get("pix_fmt")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let profile = stream
        .get("profile")
        .and_then(Value::as_str)
        .map(str::to_string);
    let dim = |key: &str| {
        stream
            .get(key)
            .and_then(Value::as_u64)
            .and_then(|v| u32::try_from(v).ok())
    };
    let (width, height) = (dim("width"), dim("height"));

    let mut keyframe_times = Vec::new();
    let mut last_packet_time: Option<f64> = None;
    let mut first_packet_time: Option<f64> = None;
    let mut total_bytes: u64 = 0;
    for packet in json
        .get("packets")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(t) = packet
            .get("pts_time")
            .and_then(Value::as_str)
            .and_then(|s| s.parse::<f64>().ok())
        else {
            continue;
        };
        last_packet_time = Some(last_packet_time.map_or(t, |prev| prev.max(t)));
        first_packet_time = Some(first_packet_time.map_or(t, |prev| prev.min(t)));
        total_bytes += packet
            .get("size")
            .and_then(Value::as_str)
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let is_key = packet
            .get("flags")
            .and_then(Value::as_str)
            .is_some_and(|f| f.contains('K'));
        if is_key {
            keyframe_times.push(t);
        }
    }
    keyframe_times.sort_by(|a, b| a.total_cmp(b));
    let avg_kbps = match (first_packet_time, last_packet_time) {
        (Some(first), Some(last)) if last - first >= MIN_BITRATE_SPAN_S && total_bytes > 0 => {
            Some((total_bytes as f64 * 8.0 / (last - first) / 1000.0).round() as u32)
        }
        _ => None,
    };

    Some(VideoStreamFacts {
        codec_name,
        pix_fmt,
        profile,
        width,
        height,
        avg_kbps,
        keyframe_times,
        last_packet_time,
    })
}

/// the actual decision, kept pure for testing.
pub fn copy_verdict(facts: &VideoStreamFacts) -> CopyVerdict {
    if facts.codec_name != "h264" {
        return CopyVerdict::ReEncode(format!("video codec is {}", facts.codec_name));
    }
    if facts.pix_fmt != "yuv420p" {
        return CopyVerdict::ReEncode(format!("pixel format is {}", facts.pix_fmt));
    }
    match facts.profile.as_deref() {
        Some(p) if COPYABLE_H264_PROFILES.contains(&p) => {}
        other => {
            return CopyVerdict::ReEncode(format!("h264 profile is {}", other.unwrap_or("unknown")))
        }
    }
    if let (Some(w), Some(h)) = (facts.width, facts.height) {
        if w.max(h) > MAX_COPY_LONG_EDGE {
            return CopyVerdict::ReEncode(format!(
                "{w}x{h} is bigger than 1080p (long edge max {MAX_COPY_LONG_EDGE})"
            ));
        }
    } else {
        return CopyVerdict::ReEncode("frame size unknown".to_string());
    }
    if let Some(kbps) = facts.avg_kbps {
        if kbps > MAX_COPY_VIDEO_KBPS {
            return CopyVerdict::ReEncode(format!(
                "video bitrate ~{kbps}k (max {MAX_COPY_VIDEO_KBPS}k)"
            ));
        }
    }
    let Some(&first_key) = facts.keyframe_times.first() else {
        return CopyVerdict::ReEncode("no keyframes found".to_string());
    };
    let mut max_gap: f64 = 0.0;
    for pair in facts.keyframe_times.windows(2) {
        max_gap = max_gap.max(pair[1] - pair[0]);
    }
    // the stretch after the last keyframe counts too - one keyframe at 0s
    // followed by 60s of packets is a 60s gap, not "no gaps".
    if let Some(last) = facts.last_packet_time {
        let last_key = *facts.keyframe_times.last().unwrap_or(&first_key);
        max_gap = max_gap.max(last - last_key);
    }
    if max_gap > MAX_COPY_KEYFRAME_GAP_S {
        return CopyVerdict::ReEncode(format!(
            "keyframes up to {max_gap:.1}s apart (max {MAX_COPY_KEYFRAME_GAP_S}s)"
        ));
    }
    CopyVerdict::Copy
}

/// runs ffprobe over the start of `path` and decides copy vs re-encode.
/// any probe failure falls back to re-encoding - the safe, known-working
/// path.
pub async fn probe_copy_verdict(path: &str) -> CopyVerdict {
    let ffprobe = crate::config::get_config()
        .media
        .ffprobe_path
        .clone()
        .unwrap_or_else(|| "ffprobe".to_string());
    let verdict = match run_ffprobe(&ffprobe, Path::new(path)).await {
        Ok(json) => match parse_ffprobe_json(&json) {
            Some(facts) => copy_verdict(&facts),
            None => CopyVerdict::ReEncode("no video stream found".to_string()),
        },
        Err(reason) => CopyVerdict::ReEncode(reason),
    };
    match &verdict {
        CopyVerdict::Copy => info!("[radio-source-probe] {path}: stream-ready h264, copying video"),
        CopyVerdict::ReEncode(reason) => {
            info!("[radio-source-probe] {path}: re-encoding video ({reason})")
        }
    }
    verdict
}

async fn run_ffprobe(ffprobe: &str, path: &Path) -> Result<Value, String> {
    let mut cmd = tokio::process::Command::new(ffprobe);
    cmd.args([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-read_intervals",
        &format!("%+{PROBE_WINDOW_S}"),
        "-show_entries",
        "stream=codec_name,pix_fmt,profile,width,height:packet=pts_time,flags,size",
        "-of",
        "json",
    ])
    .arg(path)
    .kill_on_drop(true);
    crate::process_ext::hide_console_window(&mut cmd);
    let output = match tokio::time::timeout(PROBE_TIMEOUT, cmd.output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => {
            warn!("[radio-source-probe] failed to run {ffprobe}: {e}");
            return Err(format!("ffprobe failed to start: {e}"));
        }
        Err(_) => return Err(format!("ffprobe timed out after {PROBE_TIMEOUT:?}")),
    };
    if !output.status.success() {
        return Err(format!(
            "ffprobe exited with {:?}: {}",
            output.status.code(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("unparseable ffprobe output: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn facts(keys: &[f64], last: f64) -> VideoStreamFacts {
        VideoStreamFacts {
            codec_name: "h264".to_string(),
            pix_fmt: "yuv420p".to_string(),
            profile: Some("High".to_string()),
            width: Some(1920),
            height: Some(1080),
            avg_kbps: Some(3800),
            keyframe_times: keys.to_vec(),
            last_packet_time: Some(last),
        }
    }

    #[test]
    fn regular_three_second_keyframes_are_copied() {
        let f = facts(&[0.0, 3.0, 6.0, 9.0, 12.0], 14.9);
        assert_eq!(copy_verdict(&f), CopyVerdict::Copy);
    }

    #[test]
    fn x264_default_ten_second_gop_is_re_encoded() {
        let f = facts(&[0.0, 10.4, 20.8], 29.9);
        assert!(matches!(copy_verdict(&f), CopyVerdict::ReEncode(_)));
    }

    #[test]
    fn a_long_tail_after_the_last_keyframe_counts_as_a_gap() {
        let f = facts(&[0.0], 59.9);
        assert!(matches!(copy_verdict(&f), CopyVerdict::ReEncode(_)));
    }

    #[test]
    fn scenecut_keyframes_between_forced_ones_are_fine() {
        let f = facts(&[0.0, 1.2, 3.0, 6.0, 7.7, 9.0], 11.0);
        assert_eq!(copy_verdict(&f), CopyVerdict::Copy);
    }

    #[test]
    fn non_h264_or_10_bit_sources_are_re_encoded() {
        let mut f = facts(&[0.0, 3.0], 5.0);
        f.codec_name = "hevc".to_string();
        assert!(matches!(copy_verdict(&f), CopyVerdict::ReEncode(_)));
        let mut f = facts(&[0.0, 3.0], 5.0);
        f.pix_fmt = "yuv420p10le".to_string();
        assert!(matches!(copy_verdict(&f), CopyVerdict::ReEncode(_)));
        let mut f = facts(&[0.0, 3.0], 5.0);
        f.profile = Some("High 10".to_string());
        assert!(matches!(copy_verdict(&f), CopyVerdict::ReEncode(_)));
    }

    #[test]
    fn bigger_than_1080p_is_re_encoded_in_either_orientation() {
        let mut f = facts(&[0.0, 3.0], 5.0);
        f.width = Some(3840);
        f.height = Some(2160);
        assert!(matches!(copy_verdict(&f), CopyVerdict::ReEncode(_)));
        f.width = Some(2160);
        f.height = Some(3840);
        assert!(matches!(copy_verdict(&f), CopyVerdict::ReEncode(_)));
        // portrait 1080p and smaller sources are fine.
        f.width = Some(1080);
        f.height = Some(1920);
        assert_eq!(copy_verdict(&f), CopyVerdict::Copy);
        f.width = Some(640);
        f.height = Some(480);
        assert_eq!(copy_verdict(&f), CopyVerdict::Copy);
        f.width = None;
        assert!(matches!(copy_verdict(&f), CopyVerdict::ReEncode(_)));
    }

    #[test]
    fn heavy_bitrate_is_re_encoded_and_unknown_bitrate_is_not_held_against_it() {
        let mut f = facts(&[0.0, 3.0], 5.0);
        f.avg_kbps = Some(MAX_COPY_VIDEO_KBPS + 1);
        assert!(matches!(copy_verdict(&f), CopyVerdict::ReEncode(_)));
        f.avg_kbps = None;
        assert_eq!(copy_verdict(&f), CopyVerdict::Copy);
    }

    #[test]
    fn bitrate_is_averaged_over_the_window() {
        // 3 packets of 500_000 bytes across 4s -> 3000 kbps.
        let json = json!({
            "packets": [
                {"pts_time": "0.0", "flags": "K__", "size": "500000"},
                {"pts_time": "2.0", "flags": "___", "size": "500000"},
                {"pts_time": "4.0", "flags": "K__", "size": "500000"}
            ],
            "streams": [{"codec_name": "h264", "profile": "Main", "pix_fmt": "yuv420p",
                         "width": 1280, "height": 720}]
        });
        let f = parse_ffprobe_json(&json).unwrap();
        assert_eq!(f.avg_kbps, Some(3000));
        assert_eq!((f.width, f.height), (Some(1280), Some(720)));
    }

    #[test]
    fn no_keyframes_is_re_encoded() {
        let f = facts(&[], 5.0);
        assert!(matches!(copy_verdict(&f), CopyVerdict::ReEncode(_)));
    }

    #[test]
    fn parses_ffprobe_packets_out_of_decode_order() {
        let json = json!({
            "packets": [
                {"pts_time": "0.000000", "flags": "K__"},
                {"pts_time": "0.083333", "flags": "___"},
                {"pts_time": "0.041667", "flags": "___"},
                {"pts_time": "N/A", "flags": "K__"},
                {"pts_time": "3.000000", "flags": "K__"},
                {"pts_time": "3.041667", "flags": "___"}
            ],
            "streams": [{"codec_name": "h264", "profile": "Main", "pix_fmt": "yuv420p",
                         "width": 640, "height": 360}]
        });
        let f = parse_ffprobe_json(&json).unwrap();
        assert_eq!(f.codec_name, "h264");
        assert_eq!(f.profile.as_deref(), Some("Main"));
        assert_eq!(f.keyframe_times, vec![0.0, 3.0]);
        assert_eq!(f.last_packet_time, Some(3.041667));
        assert_eq!(copy_verdict(&f), CopyVerdict::Copy);
    }

    #[test]
    fn missing_video_stream_parses_to_none() {
        assert_eq!(
            parse_ffprobe_json(&json!({"streams": [], "packets": []})),
            None
        );
    }

    /// end-to-end against real ffprobe: x264's default gop vs forced 3s keyframes.
    #[tokio::test]
    #[ignore = "requires ffmpeg and ffprobe on PATH"]
    async fn real_ffprobe_distinguishes_default_gop_from_forced_keyframes() {
        let dir = tempfile::tempdir().unwrap();
        let make = |name: &str, extra: &[&str]| {
            let out = dir.path().join(name);
            let status = std::process::Command::new("ffmpeg")
                .args([
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "testsrc2=size=160x90:rate=24:duration=20",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-pix_fmt",
                    "yuv420p",
                ])
                .args(extra)
                .arg(&out)
                .status()
                .unwrap();
            assert!(status.success());
            out
        };
        let forced = make(
            "forced.mp4",
            &["-force_key_frames", "expr:gte(t,n_forced*3)"],
        );
        let default_gop = make("default.mp4", &[]);
        assert_eq!(
            probe_copy_verdict_with("ffprobe", &forced).await,
            CopyVerdict::Copy
        );
        assert!(matches!(
            probe_copy_verdict_with("ffprobe", &default_gop).await,
            CopyVerdict::ReEncode(_)
        ));
    }

    async fn probe_copy_verdict_with(ffprobe: &str, path: &Path) -> CopyVerdict {
        let json = run_ffprobe(ffprobe, path).await.unwrap();
        copy_verdict(&parse_ffprobe_json(&json).unwrap())
    }
}
