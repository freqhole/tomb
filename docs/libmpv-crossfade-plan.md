# libmpv two-deck crossfade plan

status: **planning** (2026-10-18). nothing built yet. applies to the experimental
libmpv player only (`grimoire/src/player/libmpv.rs`); the html audio backend and the
video window backend are untouched.

## goal

remove the audible gap between consecutive tracks, and smooth clicks/pops at track
boundaries, by running **two independent libmpv instances ("decks")** and overlapping a
short crossfade (default ~50ms, adjustable) between the end of one track and the start of
the next.

non-goals:

- long, DJ-style crossfades (the design allows a larger `crossfade_ms`, but 50ms is the
  target and the only value that needs to be tested heavily)
- moving queue ownership into rust. the frontend still owns the queue, shuffle, repeat
  and "what is next". rust only gets told the next path early.
- bit-exact (sample-accurate) gapless. the handoff is accurate to a few ms and the
  overlap hides the rest. see "open questions" for gapless albums.

## what we measured (so the design is not guesswork)

all from the real `libmpv-audio-rust.log` trace and mpv/libmpv experiments, 2026-10-18:

| fact                                                                       | number / result                                                                                 | consequence                                                                                                                                                   |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| natural end of track to next `loadfile`                                    | median 0.45s, p90 0.63s, max 1.61s (n=50)                                                       | the gap is frontend latency (`Ended` -> `playNext` -> resolve path -> `Load`), not mpv                                                                        |
| `loadfile` to `PlaybackRestart`                                            | median 0.03s, p90 0.06s                                                                         | decoding the next file is cheap; preloading is easy                                                                                                           |
| mpv audio device across `loadfile replace` / `playlist-next` (same format) | stays open                                                                                      | device reopen is not the problem                                                                                                                              |
| mpv device across a sample-rate change                                     | reopens (`gapless-audio=weak` default)                                                          | two decks sidestep this entirely: each deck keeps its own format                                                                                              |
| `set_property("pause", false)` on a preloaded deck                         | ~30-60us call time                                                                              | starting deck B is effectively free; start latency is then the device buffer                                                                                  |
| `set_property("volume", ..)` on two decks                                  | ~70us avg, worst ~180us; 10ms stepping held over 1s                                             | a 10ms fade-ramp tick is cheap                                                                                                                                |
| where mpv applies `volume`                                                 | `ao_post_process_data` when the driver reads samples (`audio/out/buffer.c`), not at decode time | gain changes take effect within one device buffer (~30ms on coreaudio: 1302 samples in the log), so a 50ms fade is controllable. **verify on linux/windows.** |
| `pause` property after `stop`                                              | sticky (see the 2026-10-18 fix)                                                                 | every deck load must set `pause=yes`/`pause=no` explicitly (`loadfile_args` already does)                                                                     |

not measured yet (see phase 0): real audible start latency of an unpaused deck, and
two simultaneous audio outputs on linux/windows.

## architecture

```
frontend (spume)                         grimoire::player::libmpv
-----------------                        ---------------------------------------------
owns queue/shuffle/repeat                 engine thread (owns EVERYTHING below)
                                            |
 Load{paths,..}  ------- tokio mpsc --->    |   inbox: Cmd | Deck(id, ev) | Tick
 SetNext{path}   ------->                   |
 SetCrossfade{ms}------>                    |    +-----------+      +-----------+
                                            |    | deck A    |      | deck B    |
 <---- PlayerEvent broadcast <--------------+    | Mpv       |      | Mpv       |
   State / Progress / TrackChanged           |    | events cl.|      | events cl.|
   Advanced{path}  (new)                      |    | thread -> |      | thread -> |
   Ended / Error                              |    +-----------+      +-----------+
                                            |       active             standby
                                            |       gain 1.0            gain 0.0 (paused, preloaded)
```

key decisions:

1. **one engine thread owns both decks and all state.** today there are two threads
   (`command_loop` owns the `Mpv`, `read_libmpv_events` owns the events client) that
   share nothing but a channel. with two decks that becomes a coordination problem, so
   instead: one thread, one inbox, each deck's event reader is a dumb forwarder that
   tags events with a `DeckId`.
2. **the frontend keeps deciding what is next.** rust never advances the queue on its own.
   it only consumes a preloaded `SetNext` path, and tells the frontend it did (`Advanced`).
   if no next path is armed in time, rust behaves exactly like today (`Ended`, frontend
   runs `playNext`). crossfade is purely an optimization over the existing path, so every
   failure mode degrades to current behavior.
3. **deck roles swap, decks never move.** "active" and "standby" are just indices.
4. **the pure parts are pure.** the scheduler decision and the fade math take plain
   numbers and return plain values, so they get unit tests with no mpv involved.

## wire protocol additions

grimoire `player/control.rs` (the zod schemas for `PlayerCommand`/`PlayerEvent` are
**hand-written** in the same file - add the new variants there too, the derive does not
see serde's `tag`/`rename_all`):

```rust
pub enum PlayerCommand {
    // ... existing ...

    /// path of the track that will play after the current one, or `None`
    /// to clear it (queue changed, shuffle toggled, end of queue). safe to
    /// send repeatedly; the latest value wins. ignored when crossfade is off.
    SetNext { path: Option<String> },

    /// crossfade/overlap length in ms. 0 disables the two-deck path entirely
    /// (current behavior). suggested range 0..=12_000.
    SetCrossfade { ms: u32 },
}

pub enum PlayerEvent {
    // ... existing ...

    /// the engine moved on to the preloaded `SetNext` track by itself.
    /// the frontend must treat this as "advance the queue to the item with
    /// this path" and must NOT also run `playNext` / send a `Load`.
    Advanced { path: String },
}
```

matching manual zod additions:

```ts
z.object({ kind: z.literal("set_next"), path: z.string().nullable() }),
z.object({ kind: z.literal("set_crossfade"), ms: z.number() }),
// event
z.object({ kind: z.literal("advanced"), path: z.string() }),
```

then `cd client-codegen && make all`. `TrackChanged { index, path }` stays as is: with two
decks mpv's `playlist-pos` is always 0 and means nothing, so `Advanced` carries the path.

new `PlayerEvent` variants break exhaustive matches. files to update (found with
`grep -rl PlayerEvent`): `grimoire/src/player/{noop,mod}.rs`,
`grimoire/src/api_registry/mod.rs`, `client/charnel/src-tauri/src/{player_commands,media_session}.rs`,
`client/rathole/src/**` (several), spume `playerStateSync.ts`, `backends/{libmpvBackend,htmlAudio,dummy}.ts`,
`playbackOrchestrator.ts`, `backend.ts`.

## rust: engine

### types

```rust
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum DeckId { A, B }
impl DeckId {
    fn other(self) -> Self { match self { Self::A => Self::B, Self::B => Self::A } }
}

struct Deck {
    id: DeckId,
    mpv: Mpv,              // command handle (engine thread only)
    path: Option<String>,  // what this deck currently has loaded
    gain: f64,             // 0.0..=1.0 fade gain; mpv volume = master * gain * 100
    ready: bool,           // loaded paused and PlaybackRestart seen (safe to unpause)
}

enum Inbox {
    Cmd(PlayerCommand),
    Deck(DeckId, DeckEvent),
}

/// the subset of mpv events the engine cares about, already translated.
enum DeckEvent {
    Progress { ms: u64, total_ms: u64 },
    Pause(bool),
    Loaded,            // PlaybackRestart after a load
    EndOfFile,         // EndFile(0)
    LoadFailed(String) // libmpv2 reports a failed EndFile as Err(Raw(..))
}
```

### threads

```rust
pub fn spawn_libmpv_player() -> GrimoireResult<LibmpvController> {
    let (inbox_tx, inbox_rx) = std::sync::mpsc::channel::<Inbox>();

    let deck_a = Deck::new(DeckId::A, inbox_tx.clone())?; // spawns that deck's event thread
    let deck_b = Deck::new(DeckId::B, inbox_tx.clone())?;

    // tokio -> std bridge: cmd_rx.blocking_recv() is legal on a plain thread
    let bridge_tx = inbox_tx.clone();
    thread::Builder::new().name("freqhole-libmpv-cmd-bridge".into()).spawn(move || {
        while let Some(cmd) = cmd_rx.blocking_recv() {
            if bridge_tx.send(Inbox::Cmd(cmd)).is_err() { break; }
        }
    })?;

    thread::Builder::new().name("freqhole-libmpv-engine".into()).spawn(move || {
        Engine::new(deck_a, deck_b, events_tx).run(inbox_rx);
    })?;
    // snapshot pump etc. unchanged
}
```

per-deck event reader: the existing `read_libmpv_events` match arms, but instead of
`emit(&events, ..)` it does `inbox_tx.send(Inbox::Deck(id, DeckEvent::..))`. the
`ever_loaded` guard (ignore the spurious initial `pause=false`/`idle-active=true`
notifications) stays in the reader. the `Err(e)` arm (failed end-file) maps to
`DeckEvent::LoadFailed`.

### the loop

```rust
fn run(mut self, inbox: Receiver<Inbox>) {
    loop {
        // fast tick only while something time-critical is pending
        let wait = if self.needs_fast_tick() { Duration::from_millis(10) }
                   else { Duration::from_millis(250) };
        match inbox.recv_timeout(wait) {
            Ok(Inbox::Cmd(cmd))        => self.on_command(cmd),
            Ok(Inbox::Deck(id, ev))    => self.on_deck_event(id, ev),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        self.tick(Instant::now());
    }
    let _ = self.deck_a.mpv.command("quit", &[]);
    let _ = self.deck_b.mpv.command("quit", &[]);
}
```

(`recv_timeout` provides the tick cadence.)

### state machine

```rust
enum Phase {
    /// nothing loaded / queue ended.
    Idle,
    /// active deck playing; standby empty or not yet being prepared.
    Playing,
    /// standby deck is loading `path` paused. waiting for `Loaded`.
    Preparing { path: String },
    /// standby is loaded, paused, volume 0, ready to start instantly.
    Armed { path: String },
    /// both decks audible; gains ramping. `elapsed_before_pause` lets
    /// pause/resume freeze the fade clock.
    Crossfading { started: Instant, elapsed_before_pause: Duration, path: String },
}
```

transitions (all driven by `tick`):

```
Playing  --(next path known && remaining <= prepare_lead)-->  Preparing
Preparing --(DeckEvent::Loaded from standby)-->               Armed
Preparing/Armed --(SetNext changed or cleared)-->             unload standby, back to Playing
Armed    --(remaining <= fade + start_compensation)-->        Crossfading   (unpause standby)
Crossfading --(fade complete)-->                              Playing (roles swapped; old deck stopped)
any      --(Load / Stop)-->                                   Idle or Playing, standby unloaded
```

### the scheduler as a pure function

so the timing logic is unit-testable without mpv:

```rust
pub struct Timing {
    pub crossfade: Duration,          // e.g. 50ms
    pub prepare_lead: Duration,       // e.g. 5s: start preparing this long before the end
    pub start_compensation: Duration, // e.g. 20ms: unpause slightly early (device latency)
}

pub enum Action { Nothing, Prepare, StartCrossfade, Abort }

pub fn decide(
    t: &Timing,
    remaining: Option<Duration>, // active deck duration - time-pos; None if unknown
    next: NextState,             // None | Preparing | Armed
    has_next_path: bool,
) -> Action {
    let Some(rem) = remaining else { return Action::Nothing };
    match (next, has_next_path) {
        (NextState::None, true) if rem <= t.prepare_lead => Action::Prepare,
        (NextState::Armed, true) if rem <= t.crossfade + t.start_compensation => Action::StartCrossfade,
        (NextState::Preparing | NextState::Armed, false) => Action::Abort, // next was cleared
        _ => Action::Nothing,
    }
}
```

`remaining` comes from polling the active deck each tick:

```rust
let pos = deck.mpv.get_property::<f64>("time-pos").ok()?;
let dur = deck.mpv.get_property::<f64>("duration").ok()?;
Some(Duration::from_secs_f64((dur - pos).max(0.0)))
```

(~70us per property read; fine at 10ms cadence, only near the end of a track. use the
250ms cadence otherwise - `prepare_lead` of seconds makes that precise enough.)

edge: tracks shorter than `prepare_lead + crossfade` (intros, skits). `decide` fires
`Prepare` immediately; `Armed` may arrive after `rem` is already below the crossfade
threshold, which just means `StartCrossfade` fires on the next tick. if the standby is
still not `Loaded` when the active deck hits EOF, fall back to `Ended` (old path).

### preparing the standby deck

```rust
fn prepare_standby(&mut self, path: &str) -> Result<(), String> {
    let standby = self.standby_mut();
    // paused + silent: must be at volume 0 BEFORE it can ever be unpaused
    standby.mpv.set_property("volume", 0.0).map_err(..)?;
    let args = loadfile_args(path, None, /* start_paused */ true);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    standby.mpv.command("loadfile", &refs).map_err(..)?;
    standby.path = Some(path.to_string());
    standby.ready = false; // set true on DeckEvent::Loaded (PlaybackRestart)
    Ok(())
}
```

a paused preloaded deck already has its audio output open with the first buffer filled
(visible in the earlier mpv log: "audio ready ... audio=playing ... (paused)"), which is
why unpausing it is instant.

### the crossfade

fade math (pure, tested):

```rust
/// equal-power curves: gains satisfy out^2 + in^2 = 1, so uncorrelated
/// material keeps constant loudness through the overlap.
pub fn fade_gains(progress: f64) -> (f64 /*outgoing*/, f64 /*incoming*/) {
    let p = progress.clamp(0.0, 1.0);
    let theta = p * std::f64::consts::FRAC_PI_2;
    (theta.cos(), theta.sin())
}
```

(linear `1-p` / `p` is the alternative for highly correlated material such as gapless
album tracks; equal-power sums to up to ~+3dB there. see open questions - make the
curve a parameter.)

starting and driving it:

```rust
fn start_crossfade(&mut self, now: Instant) {
    let path = /* armed path */;
    let incoming = self.standby_mut();
    incoming.mpv.set_property("volume", 0.0).ok();   // belt and braces
    incoming.mpv.set_property("pause", false).ok();  // ~40us; audio follows within a device buffer
    self.phase = Phase::Crossfading { started: now, elapsed_before_pause: Duration::ZERO, path };
}

fn drive_crossfade(&mut self, now: Instant) {
    let Phase::Crossfading { started, elapsed_before_pause, path } = &self.phase else { return };
    let elapsed = *elapsed_before_pause + now.duration_since(*started);
    let p = (elapsed.as_secs_f64() / self.timing.crossfade.as_secs_f64()).min(1.0);
    let (out_g, in_g) = fade_gains(p);

    self.active_mut().gain = out_g;
    self.standby_mut().gain = in_g;
    self.apply_volumes(); // master * gain * 100 on both decks

    if p >= 1.0 { self.finish_crossfade(path.clone()); }
}

fn finish_crossfade(&mut self, path: String) {
    // outgoing deck: silent now, so a hard stop is inaudible
    let _ = self.active_mut().mpv.command("stop", &[]);
    self.active_mut().path = None;
    self.active_mut().gain = 0.0;

    self.active = self.active.other();   // roles swap
    self.active_mut().gain = 1.0;
    self.apply_volumes();

    self.phase = Phase::Playing;
    emit(&self.events, PlayerEvent::Advanced { path });
}
```

volume application (master volume is `SetVolume`, `0.0..=2.0`, today `v * 100`):

```rust
fn apply_volumes(&self) {
    for d in [&self.deck_a, &self.deck_b] {
        let _ = d.mpv.set_property("volume", self.master * d.gain * 100.0);
    }
}
```

with a 50ms fade and a 10ms tick that is ~5 steps. that is enough for a click-free
overlap (it is the near-hard-cut that causes the click, not steps in the ramp). if it is
not, tick at 5ms or step by device-buffer boundaries - decide after the phase 0 listening
test.

### progress and state semantics

- `Progress` is only forwarded from the **active** deck. during the overlap the incoming
  deck is not active yet, so progress stalls for ~50ms and then jumps to the new track's
  position when roles swap. acceptable; the ui already tolerates jumps on track change.
- `State` events: `Playing` through the whole handoff, never a transient `Paused`/`Stopped`.
  the outgoing deck's own `pause`/`idle-active` property events must be **dropped**
  (they come from a non-active deck) or the ui flickers and the media session folds a
  bogus `Ended`.
- `Ended` is only emitted when the _active_ deck reaches EOF and there is no armed next.

### edge cases

| situation                                                                | behavior                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SetNext` arrives after the active deck is within `crossfade` of the end | too late: ignore, let the track end, emit `Ended` as today (frontend `playNext` path)                                                                                                                                                                                   |
| `SetNext` changes/clears while `Preparing`/`Armed`                       | `stop` the standby deck, back to `Playing`; re-prepare if a new path is set                                                                                                                                                                                             |
| user `Pause` during `Crossfading`                                        | pause both decks, store `elapsed_before_pause`; `Play` resumes both and the fade clock                                                                                                                                                                                  |
| user `Pause` while `Armed`                                               | nothing special: the trigger is based on active-deck position, which stops advancing                                                                                                                                                                                    |
| user `Seek`                                                              | if `Armed`/`Preparing`: keep standby. if `Crossfading`: snap to finish (`finish_crossfade`) first, then seek the new active deck. a seek that moves the active deck far from the end should drop the standby only if `decide` says so (it will not, remaining is large) |
| `Load` (user picks a track)                                              | ramp active deck to 0 over ~30ms (phase 7), unload standby, then `loadfile` on the active deck. never leave a stale standby around                                                                                                                                      |
| `Next`/`Previous`/`Stop`                                                 | same as `Load`: short ramp-out, clear standby                                                                                                                                                                                                                           |
| `SetVolume`                                                              | store `master`, `apply_volumes()` immediately (also mid-fade)                                                                                                                                                                                                           |
| `SetOutputDevice`                                                        | set `audio-device` on **both** decks                                                                                                                                                                                                                                    |
| standby deck fails to load (`LoadFailed`)                                | log at `warn`, go back to `Playing` with no next armed: old `Ended` path takes over. do not surface a user-facing error for the preload, only if the actual advance later fails                                                                                         |
| second audio output refused (e.g. exclusive ALSA hw device)              | treat as "crossfade unavailable": `warn` once, behave as `crossfade_ms = 0`                                                                                                                                                                                             |
| `SetCrossfade{0}`                                                        | never prepare a standby; engine behaves like today with deck A only (deck B is created lazily)                                                                                                                                                                          |
| active deck hits EOF while `Crossfading`                                 | expected when the fade is aligned with the end; ignore the active `EndOfFile` and let `finish_crossfade` complete                                                                                                                                                       |
| track duration unknown (streams, broken headers)                         | `remaining = None` -> never crossfade, old path                                                                                                                                                                                                                         |

## frontend (spume)

the work is mostly "know the next path early, and react when rust advanced by itself".

1. **extract path resolution** out of `LibmpvBackend.loadAndPlay` into
   `resolveSongPath(song): Promise<string>` (blake3 lookup -> `resolveLocalPath` ->
   sync / ephemeral fetch fallback). `loadAndPlay` then calls it; `prepareNext` calls it
   too. no side effects: no `setCurrentSong`, no load-guard, no `bridgeClearExternal`.
2. **send `SetNext` early.** the existing rolling pre-cache window
   (`triggerPreCache`, fired from `playMediaItem`) already tries to have upcoming songs
   on disk. hook the same moment:

   ```ts
   // after a song starts (and whenever the queue / shuffle / repeat changes
   // what "next" is), tell the backend the next path - or clear it.
   async function syncNext(backend: LibmpvBackend) {
     const next = peekNextSong(); // honors shuffle/repeat; null at end of queue
     if (!next) return backend.send({ kind: "set_next", path: null });
     const path = await backend.resolveSongPath(next.song).catch(() => null);
     // only apply if "next" is still the same item after the await
     if (peekNextSong()?.key === next.key) {
       await backend.send({ kind: "set_next", path });
     }
   }
   ```

   re-run it on: track start, queue mutation, shuffle toggle, repeat mode change.
   rust treats the latest value as truth, so redundant sends are harmless.

3. **handle `advanced`** in the libmpv backend / `bindAutoAdvance`:

   ```ts
   if (event.kind === "advanced") {
     const item = findQueueItemByPath(event.path); // path -> media item
     if (item) void commitAdvance(item); // NOT playNext(), NOT Load
     return;
   }
   ```

   `commitAdvance` = everything `playMediaItem`/`playSong` does _after_ the load succeeds:
   update `current_item_key` + `setCurrentSong`, update `loadedSongKey`, fire
   `triggerPreCache`, refresh the media session, run `removeEndedItemFromQueue(prevKey)`
   when `isActivePlayer()` (cenotaph), reset `networkRetriedKey`. audit
   `playSong` for the full list before writing it.

4. **ephemeral file lifetime.** when `sync_queue_to_local` is off, songs are played from
   `_ephemeral/` and cleaned up "on the next track / stop / dispose". with two decks the
   _outgoing_ file is still open during the overlap and the _incoming_ one must not be
   deleted by the previous-track cleanup. move cleanup to run on `advanced`, keyed by path.
5. **settings.** an experimental-player section in `SettingsView.tsx`: crossfade length
   (0 = off, default 50ms). send `set_crossfade` at backend start and on change.
6. **fallback stays.** if `advanced` never arrives (no `SetNext`, late, deck failure), rust
   emits `ended` and the existing `bindAutoAdvance` -> `playNext` path runs unchanged.

## testing

no-mpv unit tests (fast, run everywhere):

```rust
#[test]
fn decide_prepares_inside_lead_window() { /* rem = 4s, lead = 5s -> Prepare */ }

#[test]
fn decide_starts_when_armed_and_inside_fade_window() { /* rem = 60ms, fade 50 + comp 20 -> StartCrossfade */ }

#[test]
fn decide_aborts_when_next_cleared() { /* Armed, has_next_path=false -> Abort */ }

#[test]
fn fade_is_equal_power() {
    for i in 0..=100 {
        let (o, n) = fade_gains(i as f64 / 100.0);
        assert!((o * o + n * n - 1.0).abs() < 1e-9);
    }
}
```

real-libmpv tests (same pattern as `load_pause_tests`: `ao=null`, `vo=null`, lavfi
sources `av://lavfi:sine=d=4`, skipped when libmpv is unavailable):

```rust
#[test]
fn handoff_swaps_roles_and_emits_advanced() {
    // spawn engine with two ~2s sine "tracks", SetNext(second), SetCrossfade(50),
    // Load(first); assert events: State(Playing) .. Advanced{second} .. no Ended
    // until the second ends; assert active deck gain == 1.0 and old deck idle.
}

#[test]
fn late_set_next_falls_back_to_ended() { /* SetNext after the window -> Ended, no Advanced */ }

#[test]
fn clearing_next_unloads_standby() { /* SetNext(Some) then SetNext(None) -> standby path None */ }
```

manual matrix (needs real speakers, 50ms is short - use a click-track and a pure sine to
hear seams):

- same-format album tracks (44.1k flac -> 44.1k flac)
- mixed format (44.1k -> 48k, mp3 -> flac)
- very short track (< 6s) in the middle of a queue
- skip during `Preparing`, `Armed`, and `Crossfading`
- pause/seek during each phase
- shuffle toggled while `Armed`
- remote song whose file is not on disk yet when `prepare_lead` hits
- output device switch mid-track
- macOS, windows, linux (two outputs, shared device)

observability: log (at `debug`, target `grimoire::player::libmpv`, so it rides the new
debug gate) each handoff with `expected_remaining`, actual deck positions at start, and
`prepare -> armed` duration. that is how real-world drift gets tuned without guessing.

## tasks

phase 0 - spike on real audio (de-risk before building)

- [ ] two libmpv instances, real `coreaudio` output: confirm both open and mix
- [ ] measure audible start latency of an unpaused preloaded deck (record to a file via
      loopback or an input tap; compare against the unpause timestamp); derive `start_compensation`
- [ ] confirm 50ms volume ramps are click-free by ear on a pure sine, at 5ms and 10ms steps
- [ ] repeat the two-output check on linux (pipewire/pulse and plain ALSA) and windows (wasapi shared)

phase 1 - restructure without changing behavior

- [ ] introduce `Deck` and the single engine thread + inbox; keep deck B unused
- [ ] port every `apply_command` arm and the event-reader arms onto the engine (no behavior change)
- [ ] keep the pause fix (`loadfile_args`) and the failed-load -> `playback_failed` mapping
- [ ] existing `player::libmpv` tests still pass; add a regression test that a one-deck engine
      behaves like the old controller (Load, Pause, Stop, Load plays)

phase 2 - pure logic

- [ ] `Timing`, `decide`, `NextState`, `Action` + unit tests
- [ ] `fade_gains` (equal-power) + unit test; optional linear curve behind a parameter

phase 3 - wire protocol

- [ ] `SetNext`, `SetCrossfade`, `Advanced` in `control.rs` (+ manual zod schemas)
- [ ] fix every exhaustive `PlayerEvent`/`PlayerCommand` match (list above), including
      `noop.rs`, rathole, and charnel `media_session.rs` (`Advanced` folds like a track change
      with `playing=true`, never a pause/ended)
- [ ] `cd client-codegen && make all`

phase 4 - handoff

- [ ] standby preparation (`Preparing` -> `Armed`), event routing by `DeckId`
- [ ] `start_crossfade` / `drive_crossfade` / `finish_crossfade`
- [ ] drop non-active deck `pause`/`idle-active`/`EndFile` events
- [ ] `Advanced` emission, deck role swap
- [ ] real-libmpv tests (handoff, late `SetNext`, clearing `SetNext`)

phase 5 - interactions

- [ ] pause/resume freezes the fade clock; seek snaps; volume + output device on both decks
- [ ] `Load`/`Next`/`Previous`/`Stop` clear the standby
- [ ] standby load failure and refused-second-output fallbacks (`warn` once, behave as off)

phase 6 - frontend

- [ ] extract `resolveSongPath` from `loadAndPlay`
- [ ] `syncNext` (track start, queue/shuffle/repeat changes)
- [ ] `advanced` handler + `commitAdvance` (audit `playSong` side effects)
- [ ] ephemeral cleanup moved to `advanced`, keyed by path
- [ ] cenotaph `removeEndedItemFromQueue` still fires on an `advanced` handoff

phase 7 - skip smoothing (independently shippable; fixes abrupt cuts even without crossfade)

- [ ] ~30ms ramp-out on the active deck before `Load`/`Next`/`Previous`/`Stop`

phase 8 - settings + docs

- [ ] crossfade length setting (0 = off) in `SettingsView.tsx`, sent as `set_crossfade`
- [ ] update `docs/libmpv-experimental-player-plan.md` (it currently states there is no
      watchdog/supervisor and a single `Mpv`)

phase 9 - verify

- [ ] manual matrix above on macOS; spot checks on windows and linux
- [ ] review `debug` handoff logs from a few hours of real listening, tune `prepare_lead` and
      `start_compensation`

## open questions

- **gapless albums.** a ~50ms overlap is timing-accurate to a few ms, not bit-exact. most
  players skip the crossfade for consecutive tracks of the same album. do we want an
  "album continuity" rule (crossfade 0 / gapless when the next track is the next
  track number of the same album), or one setting for everything? with equal-power curves
  and correlated material the overlap can be up to ~+3dB; a linear curve is better there.
- **shuffle / repeat-one.** crossfading a track into itself (repeat-one) is two decks
  loading the same path - fine technically; decide if it should be crossfaded or hard-looped.
- **long crossfades.** `crossfade_ms` up to several seconds works with the same engine, but
  `prepare_lead` must stay comfortably larger, and "skip during crossfade" gets more visible.
- **replaygain.** not enabled today. if added later it applies per deck via mpv's own
  `replaygain` options and multiplies with `gain`; no engine changes expected.
- **battery/CPU.** two audio outputs held open for `prepare_lead` seconds per track; expected
  negligible, check on a laptop on battery.
