//! portable video/image playback state — no mpv/process deps.
//!
//! mirrors the pattern of `client/charnel/src-tauri/src/video_window/
//! backend.rs` (`VideoCommand`/`VideoEvent`/`PlayerState`), adapted for
//! rathole: no window/fullscreen-toggle concept (rathole's video
//! surface fills the whole physical display), but adds a `ShowImage`
//! command for displaying stills (pairing qr, album/poster art) via
//! the same player process — mpv treats an image file as a one-frame
//! "video", so there's no need for a separate image subsystem.
//!
//! shells provide a `VideoPlayer` impl (see
//! `super::super::transport::VideoPlayer`) that actually drives mpv;
//! this module only holds the portable command/event/state shapes so
//! they compile and unit-test on every platform, same as
//! `super::music`'s relationship to grimoire's rodio player.

use serde::{Deserialize, Serialize};

/// what the app asks the video/image backend to do.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum VideoCommand {
    /// open a video file and begin playing it.
    Load {
        path: String,
        title: Option<String>,
        start_seconds: Option<f64>,
    },
    /// display a still image (pairing qr, album/poster art) full
    /// screen — shares this same command channel rather than a
    /// separate image-display subsystem.
    ShowImage {
        path: String,
    },
    Play,
    Pause,
    TogglePlay,
    Seek {
        seconds: f64,
    },
    SetVolume {
        volume: f64,
    },
    /// ask the backend to report its available audio output devices
    /// (e.g. pi hdmi vs. 3.5mm jack vs. a usb dac) via
    /// `VideoEvent::AudioDevices`.
    ListAudioDevices,
    /// switch the backend's audio output to a specific device (the
    /// `name` from a previously-reported [`AudioDeviceInfo`]).
    SetAudioDevice {
        name: String,
    },
    /// stop playback / dismiss the still image and free the backend
    /// process's display surface.
    Close,
}

/// what the video/image backend reports back.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum VideoEvent {
    Duration {
        seconds: f64,
    },
    Position {
        seconds: f64,
    },
    Playing,
    Paused,
    Ended,
    /// the backend process exited or was closed other than via a
    /// `Close` command we issued (e.g. it crashed).
    Closed,
    Error {
        message: String,
    },
    /// reply to `VideoCommand::ListAudioDevices`.
    AudioDevices {
        devices: Vec<AudioDeviceInfo>,
    },
}

/// one audio output device, as reported by the backend (mpv's
/// `audio-device-list` property, or grimoire/cpal's device list for
/// the rodio audio path). `name` is the identifier to send back in
/// `VideoCommand::SetAudioDevice`/the rodio equivalent (e.g. mpv's
/// `"alsa/hw:1,0"`); `description` is a human-readable label for the
/// controller's ui (e.g. `"bcm2835 HDMI 1"`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub description: String,
}

/// mirrors the states the ui distinguishes. kept separate from
/// `super::music::PlayerState` because video also needs `Ended`/
/// `Error` as first-class states (the audio player folds end-of-track
/// and errors into other events instead).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum VideoPlaybackState {
    #[default]
    Idle,
    Loading,
    Playing,
    Paused,
    Ended,
    Error,
}

/// portable state the ui mirrors, folded from `VideoEvent`s. kept
/// separate from the mpv process so its transitions can be unit
/// tested without a real player, same as charnel's `PlayerState`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct VideoPlayerState {
    pub state: VideoPlaybackState,
    pub position: f64,
    pub duration: Option<f64>,
    pub volume: f64,
    pub path: Option<String>,
    pub title: Option<String>,
    pub last_error: Option<String>,
    /// most recently reported device list (from `VideoEvent::
    /// AudioDevices`); empty until a `ListAudioDevices` round trip
    /// completes at least once.
    pub audio_devices: Vec<AudioDeviceInfo>,
    /// name of the device we last asked the backend to switch to
    /// (optimistic - the backend doesn't currently confirm which
    /// device ended up active).
    pub selected_audio_device: Option<String>,
}

impl VideoPlayerState {
    pub fn new() -> Self {
        Self {
            volume: 1.0,
            ..Self::default()
        }
    }

    /// fold an event into the state. returns true when something the
    /// ui cares about actually changed, so callers can skip
    /// redundant redraws.
    pub fn apply(&mut self, event: &VideoEvent) -> bool {
        let before = self.clone();
        match event {
            VideoEvent::Duration { seconds } => self.duration = Some(*seconds),
            VideoEvent::Position { seconds } => self.position = *seconds,
            VideoEvent::Playing => self.state = VideoPlaybackState::Playing,
            VideoEvent::Paused => {
                // an ended stream that reports paused stays ended: mpv
                // pauses itself at eof and we must not present that as
                // a resumable pause.
                if self.state != VideoPlaybackState::Ended {
                    self.state = VideoPlaybackState::Paused;
                }
            }
            VideoEvent::Ended => {
                self.state = VideoPlaybackState::Ended;
                if let Some(d) = self.duration {
                    self.position = d;
                }
            }
            VideoEvent::Closed => *self = VideoPlayerState::new(),
            VideoEvent::Error { message } => {
                self.state = VideoPlaybackState::Error;
                self.last_error = Some(message.clone());
            }
            VideoEvent::AudioDevices { devices } => {
                self.audio_devices = devices.clone();
            }
        }
        *self != before
    }

    /// apply a command's optimistic local effect, mirroring
    /// `apply_command` in charnel's backend.rs — the real transition
    /// still arrives via events off the ipc socket; this just keeps
    /// the ui from lagging a round trip.
    pub fn apply_command(&mut self, command: &VideoCommand) {
        match command {
            VideoCommand::Load {
                path,
                title,
                start_seconds,
            } => {
                *self = VideoPlayerState {
                    state: VideoPlaybackState::Loading,
                    position: start_seconds.unwrap_or(0.0),
                    volume: self.volume,
                    path: Some(path.clone()),
                    title: title.clone(),
                    ..Default::default()
                };
            }
            VideoCommand::ShowImage { path } => {
                *self = VideoPlayerState {
                    state: VideoPlaybackState::Playing,
                    volume: self.volume,
                    path: Some(path.clone()),
                    ..Default::default()
                };
            }
            VideoCommand::Play => self.state = VideoPlaybackState::Playing,
            VideoCommand::Pause => self.state = VideoPlaybackState::Paused,
            VideoCommand::TogglePlay => {
                self.state = if self.state == VideoPlaybackState::Playing {
                    VideoPlaybackState::Paused
                } else {
                    VideoPlaybackState::Playing
                };
            }
            VideoCommand::Seek { seconds } => self.position = *seconds,
            VideoCommand::SetVolume { volume } => self.volume = *volume,
            VideoCommand::ListAudioDevices => {}
            VideoCommand::SetAudioDevice { name } => {
                self.selected_audio_device = Some(name.clone());
            }
            VideoCommand::Close => *self = VideoPlayerState::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_then_playing_transitions_state() {
        let mut s = VideoPlayerState::new();
        s.apply_command(&VideoCommand::Load {
            path: "movie.mp4".into(),
            title: Some("a movie".into()),
            start_seconds: None,
        });
        assert_eq!(s.state, VideoPlaybackState::Loading);
        assert!(s.apply(&VideoEvent::Duration { seconds: 100.0 }));
        assert!(s.apply(&VideoEvent::Playing));
        assert_eq!(s.state, VideoPlaybackState::Playing);
    }

    #[test]
    fn ended_pins_position_to_duration_and_resists_paused() {
        let mut s = VideoPlayerState::new();
        s.apply(&VideoEvent::Duration { seconds: 100.0 });
        s.apply(&VideoEvent::Position { seconds: 99.7 });
        s.apply(&VideoEvent::Ended);
        assert_eq!(s.state, VideoPlaybackState::Ended);
        assert_eq!(s.position, 100.0);
        // a stray paused event after eof must not un-end it.
        s.apply(&VideoEvent::Paused);
        assert_eq!(s.state, VideoPlaybackState::Ended);
    }

    #[test]
    fn position_dedupes_identical_updates() {
        let mut s = VideoPlayerState::new();
        s.apply(&VideoEvent::Duration { seconds: 100.0 });
        assert!(s.apply(&VideoEvent::Position { seconds: 1.0 }));
        assert!(!s.apply(&VideoEvent::Position { seconds: 1.0 }));
    }

    #[test]
    fn show_image_command_sets_path_and_playing() {
        let mut s = VideoPlayerState::new();
        s.apply_command(&VideoCommand::ShowImage {
            path: "qr.png".into(),
        });
        assert_eq!(s.state, VideoPlaybackState::Playing);
        assert_eq!(s.path.as_deref(), Some("qr.png"));
    }

    #[test]
    fn closed_resets_to_idle() {
        let mut s = VideoPlayerState::new();
        s.apply_command(&VideoCommand::Load {
            path: "movie.mp4".into(),
            title: None,
            start_seconds: None,
        });
        s.apply(&VideoEvent::Closed);
        assert_eq!(s, VideoPlayerState::new());
    }

    #[test]
    fn error_event_sets_state_and_message() {
        let mut s = VideoPlayerState::new();
        s.apply(&VideoEvent::Error {
            message: "no decoder plugin".into(),
        });
        assert_eq!(s.state, VideoPlaybackState::Error);
        assert_eq!(s.last_error.as_deref(), Some("no decoder plugin"));
    }

    #[test]
    fn audio_devices_event_populates_list_and_select_command_is_optimistic() {
        let mut s = VideoPlayerState::new();
        let devices = vec![
            AudioDeviceInfo {
                name: "alsa/hw:0,0".into(),
                description: "bcm2835 HDMI 1".into(),
            },
            AudioDeviceInfo {
                name: "alsa/hw:1,0".into(),
                description: "bcm2835 Headphones".into(),
            },
        ];
        assert!(s.apply(&VideoEvent::AudioDevices {
            devices: devices.clone(),
        }));
        assert_eq!(s.audio_devices, devices);

        s.apply_command(&VideoCommand::SetAudioDevice {
            name: "alsa/hw:1,0".into(),
        });
        assert_eq!(s.selected_audio_device.as_deref(), Some("alsa/hw:1,0"));
    }
}
