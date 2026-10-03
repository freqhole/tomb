// platform-agnostic core for the separate video window.
//
// deliberately free of gstreamer/gtk types so it compiles and is unit-tested on
// every platform. the linux implementation lives in `gst.rs` and is the only
// part that cannot be built on a non-linux dev machine.

#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use serde::{Deserialize, Serialize};

pub use grimoire::player::AudioDeviceInfo;

/// what the webview asks the video window to do.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum VideoCommand {
    /// open a file and begin playing it.
    Load {
        path: String,
        title: Option<String>,
        start_seconds: Option<f64>,
    },
    Play,
    Pause,
    TogglePlay,
    /// bring the window to front without changing playback state - used to
    /// recover a window that's gone behind other apps (e.g. after cmd+tab on
    /// macOS left it with no reachable way back to fullscreen).
    Show,
    Seek {
        seconds: f64,
    },
    SetVolume {
        volume: f64,
    },
    SetFullscreen {
        fullscreen: bool,
    },
    ToggleFullscreen,
    Close,
    /// query the audio output devices mpv can use for this window (mirrors
    /// `PlayerCommand::ListOutputDevices` for the libmpv music backend).
    ListOutputDevices,
    /// switch the window's audio sink to the named device (`name` is a
    /// value previously reported via `VideoEvent::OutputDevices`).
    SetOutputDevice {
        name: String,
    },
}

/// what the video window reports back. mirrors the subset of html media events
/// the playerbar already reacts to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum VideoEvent {
    /// duration became known (or changed, for a new file).
    Duration {
        seconds: f64,
    },
    Position {
        seconds: f64,
    },
    Playing,
    Paused,
    Ended,
    Fullscreen {
        fullscreen: bool,
    },
    /// the window was closed by the user (not by a `Close` command).
    Closed,
    /// playback failed. `error_type` is a stable identifier for programmatic
    /// handling; `missing_plugin` covers a missing codec/decoder.
    Error {
        error_type: String,
        message: String,
    },
    /// reply to `VideoCommand::ListOutputDevices`.
    OutputDevices {
        devices: Vec<AudioDeviceInfo>,
    },
}

/// mirrors the states the playerbar distinguishes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlaybackState {
    Idle,
    Loading,
    Playing,
    Paused,
    Ended,
    Error,
}

/// player state the UI mirrors. kept separate from the pipeline so its
/// transitions can be tested without gstreamer.
#[derive(Debug, Clone, PartialEq)]
pub struct PlayerState {
    pub state: PlaybackState,
    pub position: f64,
    pub duration: Option<f64>,
    pub volume: f64,
    pub fullscreen: bool,
    pub path: Option<String>,
    pub title: Option<String>,
}

impl Default for PlayerState {
    fn default() -> Self {
        Self {
            state: PlaybackState::Idle,
            position: 0.0,
            duration: None,
            volume: 1.0,
            fullscreen: false,
            path: None,
            title: None,
        }
    }
}

impl PlayerState {
    /// fold an event into the state. returns true when something the UI cares
    /// about actually changed, so callers can skip redundant emits.
    pub fn apply(&mut self, event: &VideoEvent) -> bool {
        let before = self.clone();
        match event {
            VideoEvent::Duration { seconds } => {
                self.duration = Some(*seconds);
            }
            VideoEvent::Position { seconds } => {
                self.position = *seconds;
            }
            VideoEvent::Playing => {
                self.state = PlaybackState::Playing;
            }
            VideoEvent::Paused => {
                // an ended stream that reports paused stays ended: the pipeline
                // pauses itself at EOS and we must not present that as a
                // resumable pause.
                if self.state != PlaybackState::Ended {
                    self.state = PlaybackState::Paused;
                }
            }
            VideoEvent::Ended => {
                self.state = PlaybackState::Ended;
                if let Some(d) = self.duration {
                    self.position = d;
                }
            }
            VideoEvent::Fullscreen { fullscreen } => {
                self.fullscreen = *fullscreen;
            }
            VideoEvent::Closed => {
                *self = PlayerState::default();
            }
            VideoEvent::Error { .. } => {
                self.state = PlaybackState::Error;
            }
            // no local state to mirror - the picker re-queries fresh every
            // time it opens rather than trusting a cached list.
            VideoEvent::OutputDevices { .. } => {}
        }
        *self != before
    }

    /// apply a command's optimistic local effect. the backend still drives the
    /// real transition via events; this keeps the UI from lagging a round trip.
    pub fn apply_command(&mut self, command: &VideoCommand) {
        match command {
            VideoCommand::Load {
                path,
                title,
                start_seconds,
            } => {
                *self = PlayerState {
                    state: PlaybackState::Loading,
                    position: start_seconds.unwrap_or(0.0),
                    volume: self.volume,
                    path: Some(path.clone()),
                    title: title.clone(),
                    ..PlayerState::default()
                };
            }
            VideoCommand::SetVolume { volume } => {
                self.volume = volume.clamp(0.0, 1.0);
            }
            VideoCommand::Seek { seconds } => {
                self.position = clamp_seek(*seconds, self.duration);
            }
            VideoCommand::SetFullscreen { fullscreen } => {
                self.fullscreen = *fullscreen;
            }
            VideoCommand::ToggleFullscreen => {
                self.fullscreen = !self.fullscreen;
            }
            // play/pause/toggle/close are reflected from real pipeline events
            // rather than guessed at - a failed load must not look like it is
            // playing.
            _ => {}
        }
    }

    /// what `TogglePlay` should resolve to right now.
    pub fn resolve_toggle(&self) -> VideoCommand {
        match self.state {
            PlaybackState::Playing => VideoCommand::Pause,
            // replaying an ended item restarts it rather than resuming at EOS
            PlaybackState::Ended => VideoCommand::Seek { seconds: 0.0 },
            _ => VideoCommand::Play,
        }
    }
}

/// clamp a seek target into the playable range. negative seeks land at 0, and
/// seeking past the end lands slightly before it so the pipeline doesn't
/// immediately report EOS.
pub fn clamp_seek(seconds: f64, duration: Option<f64>) -> f64 {
    if !seconds.is_finite() || seconds < 0.0 {
        return 0.0;
    }
    match duration {
        Some(d) if d > 0.0 && seconds > d => (d - 0.1).max(0.0),
        _ => seconds,
    }
}

/// map an mpv error into a stable `error_type`. kept here (rather
/// than in the platform-specific module) so the classification is testable
/// everywhere.
pub fn classify_error(message: &str) -> &'static str {
    let m = message.to_ascii_lowercase();
    if m.contains("no decoder") || m.contains("missing") || m.contains("not-linked") {
        "missing_plugin"
    } else if m.contains("no such file") || m.contains("no such device") {
        // deliberately NOT a broad `contains("not found")` - that also
        // matched unrelated failures (e.g. a GL/EGL pixel-format
        // negotiation error) and misreported them as a missing file, when
        // the file was never the problem. see the test below.
        "file_not_found"
    } else if m.contains("permission") {
        "permission_denied"
    } else {
        "playback_failed"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_negative_and_nonfinite_seeks_to_zero() {
        assert_eq!(clamp_seek(-5.0, Some(100.0)), 0.0);
        assert_eq!(clamp_seek(f64::NAN, Some(100.0)), 0.0);
        assert_eq!(clamp_seek(f64::NEG_INFINITY, None), 0.0);
    }

    #[test]
    fn seeking_past_the_end_lands_just_before_it() {
        // landing exactly on duration makes the pipeline fire EOS immediately
        assert_eq!(clamp_seek(120.0, Some(100.0)), 99.9);
    }

    #[test]
    fn passes_through_an_in_range_seek() {
        assert_eq!(clamp_seek(42.0, Some(100.0)), 42.0);
    }

    #[test]
    fn allows_any_seek_when_duration_is_unknown() {
        assert_eq!(clamp_seek(42.0, None), 42.0);
    }

    #[test]
    fn ended_state_survives_a_trailing_paused_event() {
        // the pipeline pauses itself at EOS; presenting that as a resumable
        // pause would make the playerbar offer "resume" at the end of a video
        let mut s = PlayerState::default();
        s.apply(&VideoEvent::Ended);
        s.apply(&VideoEvent::Paused);
        assert_eq!(s.state, PlaybackState::Ended);
    }

    #[test]
    fn ending_snaps_position_to_duration() {
        let mut s = PlayerState::default();
        s.apply(&VideoEvent::Duration { seconds: 100.0 });
        s.apply(&VideoEvent::Position { seconds: 99.7 });
        s.apply(&VideoEvent::Ended);
        assert_eq!(s.position, 100.0);
    }

    #[test]
    fn closing_resets_everything() {
        let mut s = PlayerState::default();
        s.apply_command(&VideoCommand::Load {
            path: "/tmp/a.mp4".into(),
            title: None,
            start_seconds: None,
        });
        s.apply(&VideoEvent::Playing);
        s.apply(&VideoEvent::Closed);
        assert_eq!(s, PlayerState::default());
    }

    #[test]
    fn apply_reports_whether_anything_changed() {
        let mut s = PlayerState::default();
        assert!(s.apply(&VideoEvent::Position { seconds: 1.0 }));
        assert!(!s.apply(&VideoEvent::Position { seconds: 1.0 }));
    }

    #[test]
    fn load_resets_stale_duration_and_keeps_volume() {
        let mut s = PlayerState::default();
        s.apply_command(&VideoCommand::SetVolume { volume: 0.3 });
        s.apply(&VideoEvent::Duration { seconds: 100.0 });
        s.apply_command(&VideoCommand::Load {
            path: "/tmp/b.mp4".into(),
            title: Some("b".into()),
            start_seconds: Some(12.0),
        });
        assert_eq!(
            s.duration, None,
            "stale duration would mis-scale the scrubber"
        );
        assert_eq!(s.position, 12.0);
        assert_eq!(s.volume, 0.3, "volume is a user preference, not per-item");
        assert_eq!(s.state, PlaybackState::Loading);
    }

    #[test]
    fn load_does_not_report_playing_until_the_pipeline_says_so() {
        let mut s = PlayerState::default();
        s.apply_command(&VideoCommand::Load {
            path: "/tmp/a.mp4".into(),
            title: None,
            start_seconds: None,
        });
        assert_eq!(s.state, PlaybackState::Loading);
    }

    #[test]
    fn volume_is_clamped() {
        let mut s = PlayerState::default();
        s.apply_command(&VideoCommand::SetVolume { volume: 3.0 });
        assert_eq!(s.volume, 1.0);
        s.apply_command(&VideoCommand::SetVolume { volume: -1.0 });
        assert_eq!(s.volume, 0.0);
    }

    #[test]
    fn toggle_resolves_from_current_state() {
        let mut s = PlayerState::default();
        assert_eq!(s.resolve_toggle(), VideoCommand::Play);
        s.apply(&VideoEvent::Playing);
        assert_eq!(s.resolve_toggle(), VideoCommand::Pause);
        s.apply(&VideoEvent::Paused);
        assert_eq!(s.resolve_toggle(), VideoCommand::Play);
    }

    #[test]
    fn toggling_an_ended_video_restarts_it() {
        let mut s = PlayerState::default();
        s.apply(&VideoEvent::Ended);
        assert_eq!(s.resolve_toggle(), VideoCommand::Seek { seconds: 0.0 });
    }

    #[test]
    fn fullscreen_toggles_both_ways() {
        let mut s = PlayerState::default();
        s.apply_command(&VideoCommand::ToggleFullscreen);
        assert!(s.fullscreen);
        s.apply_command(&VideoCommand::ToggleFullscreen);
        assert!(!s.fullscreen);
    }

    #[test]
    fn classifies_a_missing_decoder_so_the_wizard_can_help() {
        assert_eq!(
            classify_error("no decoder available for type video/x-h264"),
            "missing_plugin"
        );
        assert_eq!(
            classify_error("Your GStreamer installation is missing a plug-in."),
            "missing_plugin"
        );
    }

    #[test]
    fn classifies_file_and_permission_errors_apart_from_decode_errors() {
        assert_eq!(
            classify_error("No such file or directory"),
            "file_not_found"
        );
        assert_eq!(classify_error("Permission denied"), "permission_denied");
        assert_eq!(
            classify_error("Internal data stream error"),
            "playback_failed"
        );
    }

    #[test]
    fn a_negotiation_failure_is_not_misreported_as_a_missing_file() {
        // real-world case: a GL/EGL config-negotiation failure ("No
        // available configurations for the given pixel format") contains
        // neither "no such file" nor "no such device" - a prior, broader
        // `contains("not found")` check incorrectly matched this and told
        // the user their (perfectly present) file couldn't be found.
        assert_eq!(
            classify_error("No available configurations for the given pixel format"),
            "playback_failed"
        );
    }
}
