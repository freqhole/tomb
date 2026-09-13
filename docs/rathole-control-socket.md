# rathole unix control socket

a local unix domain socket rathole can listen on for simple media-control
commands - e.g. physical buttons wired to a raspberry pi's GPIO pins,
forwarded to rathole by a small script that writes a line to the socket.
off by default. no network exposure risk: unix sockets are local-machine,
filesystem-permission-gated only.

implementation: [`client/rathole/src/tty/control_socket.rs`](../client/rathole/src/tty/control_socket.rs).
tty-only (the web/wasm build has no listener) and unix-only (`#[cfg(unix)]`

- a no-op on any other target).

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
  (the listener isn't live start/stop-able mid-session today).
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
