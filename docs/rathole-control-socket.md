# unix control socket (rathole + charnel)

a local unix domain socket rathole and charnel can both listen on for
simple media-control commands - e.g. physical buttons wired to a
raspberry pi's GPIO pins, forwarded by a small script that writes a
line to the socket. off by default. no network exposure risk: unix
sockets are local-machine, filesystem-permission-gated only.

implementation: the shared listener/wire-protocol lives in
[`grimoire::control_socket`](../grimoire/src/control_socket.rs) - unix-
only (`#[cfg(unix)]` - a no-op on any other target, including the web/
wasm build, which has no listener at all). each app supplies its own
dispatch for the commands it receives, since rathole (native rodio/mpv
playback) and charnel (playback lives in the spume webview) have very
different implementations:

- rathole: [`client/rathole/src/tty/control_socket.rs`](../client/rathole/src/tty/control_socket.rs)
  (now a thin re-export) dispatches into its own tty `App`/pairing state
  - see `apply_control_socket_command`/`handle_control_socket_request` in
    [`client/rathole/src/tty/run.rs`](../client/rathole/src/tty/run.rs).
- charnel: [`client/charnel/src-tauri/src/control_socket_bridge.rs`](../client/charnel/src-tauri/src/control_socket_bridge.rs)
  reuses two already-existing bridges instead of building its own
  playback backend - see that file's own doc comment for the full
  breakdown, and "charnel-specific notes" below for what's simplified.

## enabling it

add to `freqhole-config.toml`:

```toml
[control_socket]
enabled = true
# socket_path = "/custom/path.sock"   # optional
```

- `enabled` - default `false`. can also be toggled from rathole's
  player-pairing settings screen (`u`) - like the `p`/`i` toggles there,
  this only persists the config; it takes effect on the next launch
  (the listener isn't live start/stop-able mid-session today). charnel
  has no equivalent settings-screen toggle yet - edit the config file
  directly and restart.
- `socket_path` - default `~/rathole-control.sock` (home dir) when
  unset - deliberately outside the grimoire data dir so an external
  button-wiring script can find it regardless of which config/data dir
  is active. the parent directory is created automatically; a stale
  socket file left behind by a previous, uncleanly-exited run is
  removed before binding.

## wire protocol

one command per line (newline-delimited). most commands are fire-and-
forget - no reply is written back, matching how little a physical
button can do with a reply anyway. two query commands (`get_state`,
`list_audio_devices`) DO write a single-line JSON reply back on the
same connection. an unrecognized line is logged and ignored rather
than closing the connection, so a stray/malformed write from a flaky
button script doesn't require a reconnect.

example, from a shell:

```sh
echo play_pause | nc -U ~/rathole-control.sock
echo get_state | nc -U ~/rathole-control.sock
```

## commands

| line                      | effect                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `play_pause`              | pause if currently playing, otherwise resume/play                                           |
| `next`                    | advance to the next queue entry                                                             |
| `previous`                | go back to the previous (history) entry                                                     |
| `volume_up`               | volume += 0.05 (clamped 0.0..=2.0)                                                          |
| `volume_down`             | volume -= 0.05 (clamped 0.0..=2.0)                                                          |
| `stop`                    | stop playback                                                                               |
| `show_admin_pin`          | rotates the pairing session pin with an admin grant, then shows the player-pairing overview |
| `rotate_pin`              | rotates the pairing session pin (no admin grant), then shows the player-pairing overview    |
| `show_player`             | switches focus to the player-pairing overview (qr/art/queue), without touching the pin      |
| `get_state`               | **query** - replies with a JSON now-playing/playback snapshot (see below)                   |
| `list_audio_devices`      | **query** - replies with a JSON list of the active backend's known audio output devices     |
| `set_audio_device <name>` | switches the active backend's audio output device to `<name>` (fire-and-forget)             |

every command targets whichever playback backend is actually active
(rodio, or mpv for real video / an mpv audio-fallback) - the same
backend-selection logic the keyboard player-row controls use, so a
physical button behaves identically to its keyboard equivalent.

### `get_state` reply

idle:

```json
{ "kind": "idle", "volume": 0.8 }
```

playing/paused:

```json
{
  "kind": "song",
  "title": "...",
  "artist": "...",
  "album": "...",
  "is_playing": true,
  "position_ms": 12345,
  "duration_ms": 210000,
  "volume": 0.8
}
```

`kind` is `"song"` or `"video"`; `artist`/`album` are `null` when unknown
or not applicable (e.g. video).

### `list_audio_devices` reply

```json
{ "backend": "audio", "devices": [{ "name": "...", "description": "..." }] }
```

`backend` is `"audio"` (rodio) or `"video"` (mpv), whichever is
currently active. the reply uses whatever device list is already
cached in the ui - `list_audio_devices` also triggers a background
refresh of both backends' device lists, so a caller that wants fresh
names after a device was just plugged in should query twice (once to
trigger the refresh, once shortly after to read it).

## known simplification

`show_admin_pin` and `rotate_pin` are both, today, just a rotation of the
single session pin (`show_admin_pin` additionally marks the next pairing
attempt for an admin-level grant) - there is no separate, distinctly
displayed "admin pin" value in the data model. this split is a reasonable
first interpretation of "show admin pin" / "rotate pin" as two distinct
physical-button actions, not a confirmed design decision - revisit if it
doesn't match the intended raspberry-pi remote-control workflow.

## charnel-specific notes

charnel has no playback backend of its own in rust - audio/video always
live in the spume webview - so its dispatcher (`control_socket_bridge.rs`)
reuses two already-existing bridges instead of a third implementation:

- `play_pause`/`next`/`previous`/`stop` go out over the existing
  `freqhole:media_session_action` event (the same path OS media keys
  already use) - spume's own queue-aware handler decides what each means.
- `volume_up`/`volume_down`/`get_state` go through the same
  `PlayerCommand`/`CommandAck` pipeline a real paired remote controller
  uses (`player_pairing_accept.rs`'s dispatch bridge) - always reflects
  live state, whichever backend is actually playing. volume steps by the
  same `±0.05` as rathole, but clamped to `0.0..=1.0` (spume's real
  volume range) rather than rathole's `0.0..=2.0`.
- `show_admin_pin`/`rotate_pin`/`show_player` act on the same shared
  pairing state the pairing screen and real controllers see, then bring
  charnel's main window forward and emit a `freqhole:show-player` event
  spume listens for to navigate to `/player`.
- `get_state`'s `"idle"` `kind` is reported more often than rathole's own
  reply - `PlayerStatus::Paused`/`Buffering`/`Stopped`/`Error` carry no
  media reference at all in cenotaph's wire protocol (only `NowPlaying`/
  `PlayingRadio` do), so a paused song still reports as idle (with
  whatever position/volume IS known) rather than with its real title.
- `list_audio_devices`/`set_audio_device` are unimplemented in charnel -
  no audio-output-device enumeration exists anywhere in charnel/spume
  today, for any backend. `list_audio_devices` replies with an empty
  device list (an honest answer, not an error); `set_audio_device` is
  logged and ignored.
- these commands only work once `[player_pairing].enabled` is on and
  federation has actually started this launch - `volume_up`/`volume_down`/
  `get_state`/pin commands log a warning and no-op otherwise (`play_pause`/
  `next`/`previous`/`stop` work regardless, since the media-session event
  doesn't depend on pairing at all).
