const COMMANDS: &[&str] = &[
    "set_metadata",
    "set_playback_state",
    "set_position",
    "clear",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
