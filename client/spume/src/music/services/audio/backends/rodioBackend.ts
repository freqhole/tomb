// rodio backend — talks to the supervised rust audio thread
// inside the charnel tauri host.
//
// commands go out via `invoke("player_send", { cmd })`, events come
// in via `listen("freqhole:player_event", ...)`. the wire types are
// generated from grimoire by `client-codegen` and live in the
// `freqhole-api-client` package, so this file is largely glue.
//
// **only safe to construct in tauri mode** — the html or dummy
// backend should be selected when `isCharnelMode()` is false. see
// `audio/select.ts`.

import type {
  PlayerCommand,
  PlayerEvent,
  PlayerSnapshot,
} from "freqhole-api-client";
import {
  BackendPlaybackError,
  emptySnapshot,
  type BackendKind,
  type LoadAndPlayOptions,
  type PlayerBackend,
  type PlayerEventListener,
  type Unsubscribe,
} from "../backend";
import {
  getSyncQueueToLocal,
  setCurrentSong,
} from "../../../../app/services/storage/db";
import { syncSongToLocal } from "../../sync/syncSongToLocal";
import {
  addToLoadingSet,
  removeFromLoadingSet,
  isSongOnDiskEphemeral,
} from "../../download";
import {
  fetchEphemeralForSong,
  reconcileEphemeralWithQueue,
} from "../ephemeralFetch";
import { clearExternalMediaSession as bridgeClearExternal } from "../mediaSessionBridge";
import { appState } from "../../../../app/services/storage/db";
import { createEffect, createRoot } from "solid-js";
import type { Song } from "../../storage/types";

// matches `PLAYER_EVENT` in client/charnel/src-tauri/src/player_commands.rs.
// keep these two strings in sync — there's no shared header to lean on.
const TAURI_EVENT = "freqhole:player_event";

type UnlistenFn = () => void;

/// rodio-via-tauri backend.
///
/// the constructor is cheap (no ipc); the tauri `listen` subscription
/// is set up lazily on the first `subscribe()` call so a backend that
/// was constructed but never used (e.g. by an aborted backend swap)
/// doesn't leak an event handler.
export class RodioBackend implements PlayerBackend {
  readonly kind: BackendKind = "rodio";

  private listeners = new Set<PlayerEventListener>();
  private snap: PlayerSnapshot = emptySnapshot;
  private unlistenPromise: Promise<UnlistenFn> | null = null;
  private disposed = false;

  /// dispose handle for the queue-watching reconciler effect installed
  /// in the constructor. called from `dispose()` so a backend swap
  /// doesn't leak the effect.
  private disposeReconciler: (() => void) | null = null;

  /// sha256 of the song most recently passed to `loadAndPlay`. used
  /// by the event dispatcher to clear that song from the loading set
  /// the moment the rust supervisor reports it as playable — so the
  /// row spinner / playerbar spinner never outlive the audio actually
  /// starting, regardless of which fetch path got us there.
  private currentLoadingSha256: string | null = null;

  constructor() {
    // install a reactive reconciler over `<fetch_dir>/_ephemeral/`:
    // whenever the queue changes, delete files for songs no longer
    // in the queue and seed the ui's on-disk signal from the
    // survivors. this also runs once on construction so the
    // underline indicator is populated at startup from whatever
    // was on disk from a previous session.
    //
    // we deliberately do NOT purge on init or dispose anymore: a
    // song that's still in the persisted queue should keep its
    // ephemeral file across app restarts so the user doesn't have
    // to re-fetch it on next launch.
    createRoot((dispose) => {
      this.disposeReconciler = dispose;
      createEffect(() => {
        const queue = appState()?.queue ?? [];
        const blake3s = queue
          .map((s) => s.blake3)
          .filter((b): b is string => !!b);
        void reconcileEphemeralWithQueue(blake3s);
      });
    });
  }

  async send(cmd: PlayerCommand): Promise<void> {
    if (this.disposed) {
      throw new Error("rodio backend: send called after dispose");
    }
    console.info(`[player] rodio send:`, cmd.kind, cmd);
    const { invoke } = await import("@tauri-apps/api/core");
    // tauri serializes the second arg as a json object; we need the
    // host-side `cmd: PlayerCommand` parameter name to match.
    await invoke("player_send", { cmd });
  }

  /// resolve a song to a local filesystem path via the
  /// `resolve_blob_path` tauri command, then send `Load` + `Play`
  /// to the rust supervisor.
  ///
  /// remote songs need to be on disk before rodio can play them
  /// (the decoder reads from a fs path; it can't stream from an
  /// http url). when `resolve_blob_path` returns `no_local_path`
  /// or `not_found` for a remote song, this method:
  ///   1. checks the user's `sync_queue_to_local` setting.
  ///   2. if ON: awaits `syncSongToLocal(song)` — which uses iroh-
  ///      blobs verified streaming on the rust side to fetch the
  ///      audio into the configured fetch dir and register a local
  ///      `media_blob` row with `local_path` set. then retries the
  ///      path lookup.
  ///   3. if OFF: fetches the audio into `<fetch_dir>/_ephemeral/`
  ///      via the `fetch_ephemeral_blob` tauri command (no DB
  ///      writes), plays it directly from there, and tracks the
  ///      file for cleanup on the next track / stop / dispose.
  async loadAndPlay(
    song: Song,
    options?: LoadAndPlayOptions,
  ): Promise<void> {
    if (this.disposed) {
      throw new Error("rodio backend: loadAndPlay called after dispose");
    }

    // emit a synthetic loading state so the UI shows a spinner
    // before the rust supervisor has a chance to emit its own state
    // event. mirrors the equivalent emit in `HtmlAudioBackend.playSong`
    // — without it the playerbar can sit on "paused"/"stopped" for
    // the full duration of a remote sync.
    this.emit({ kind: "state", state: "loading" });

    // remember which song we're trying to start so the dispatcher
    // can clear its loading flag on the first `playing` / `paused` /
    // `progress` event from the rust supervisor (see `dispatch`).
    this.currentLoadingSha256 = song.sha256;

    // explicitly reset MediaSession position state for a new track.
    // platforms (especially iOS lock screen) cache the position from
    // the previous track; without this reset the lock-screen scrubber
    // shows stale info until the first progress event lands.
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      try {
        navigator.mediaSession.setPositionState();
      } catch {
        // some browsers don't support this — ignore.
      }
    }

    const blobId = song.media_blob_id ?? song.sha256;
    let path: string;
    try {
      path = await this.resolveLocalPath(blobId);
    } catch (e) {
      if (!(e instanceof BackendPlaybackError)) throw e;
      // only the "missing on disk" discriminants are recoverable
      // by syncing. database/io errors should bubble up.
      const recoverable =
        e.error_type === "no_local_path" ||
        e.error_type === "not_found" ||
        // grimoire's media_blobz returns a generic "database: blob
        // not found" string for unknown ids; treat that as missing.
        e.message.includes("blob not found");
      if (!recoverable) throw e;

      // local songs that fail to resolve are a real bug — don't try
      // to "sync" a song that has no remote source.
      if (song.source_type !== "remote" || !song.remote_server_id) {
        throw new BackendPlaybackError(
          this.kind,
          "local_blob_missing",
          `local song "${song.title}" has no resolvable blob (sha256=${song.sha256.slice(0, 8)})`,
        );
      }

      if (!getSyncQueueToLocal()) {
        // OFF path: fetch the audio into `<fetch_dir>/_ephemeral/`
        // (idempotent — the rust command short-circuits if the file
        // is already on disk) and play it directly from there. no
        // DB rows are written — mirrors the OFF behavior of
        // `syncSongToLocal` (which also early-returns when the
        // setting is off).
        //
        // we deliberately do NOT delete the previous song's file
        // here: the queue-watching reconciler installed in the
        // constructor handles eviction when songs leave the queue,
        // so files for songs the user might replay (or that survive
        // an app restart in the persisted queue) stay on disk.

        // if the ephemeral file is already on disk (tracked by the
        // signal that the queue-row underline reads from), skip the
        // loading-set flicker entirely. the rust command will
        // fast-path return the existing path, so there's no real
        // wait to spinner-over.
        const alreadyOnDisk = isSongOnDiskEphemeral(song.blake3);

        if (!alreadyOnDisk) {
          console.info(
            `[player] rodio loadAndPlay: "${song.title}" not on disk yet — fetching ephemerally (sync_queue_to_local=off)`,
          );
          // light up the queue/playerbar spinner for this song while
          // we fetch. mirrors what other audio fetch paths do (see
          // blobResolver / audioAccess / autoDownload).
          addToLoadingSet(song.sha256);
        }
        let fetched;
        try {
          fetched = await fetchEphemeralForSong(song);
        } catch (err) {
          if (!alreadyOnDisk) removeFromLoadingSet(song.sha256);
          throw new BackendPlaybackError(
            this.kind,
            "ephemeral_fetch_failed",
            `failed to fetch "${song.title}" ephemerally: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        if (!alreadyOnDisk) removeFromLoadingSet(song.sha256);
        path = fetched.path;

        // skip the regular `setCurrentSong` + `resolveLocalPath`
        // dance — there's no DB row to look up, and we already have
        // the path. but still bridge the media session + reflect the
        // current song in app state for the UI.
        bridgeClearExternal();
        await setCurrentSong(song.sha256);
        console.info(
          `[player] rodio loadAndPlay (ephemeral): "${song.title}" (${song.sha256.slice(0, 8)}...) -> ${path}`,
        );
        await this.send({ kind: "load", paths: [path] });
        await this.send({ kind: "play" });
        await this.applyInitialPosition(options);
        return;
      }

      console.info(
        `[player] rodio loadAndPlay: "${song.title}" not on disk yet — syncing remote song before play`,
      );
      // light up the queue/playerbar spinner. paired with
      // `removeFromLoadingSet` after the sync resolves (success or
      // failure) so the UI never gets stuck.
      addToLoadingSet(song.sha256);
      let sync;
      try {
        sync = await syncSongToLocal({
          sha256: song.sha256,
          media_blob_id: song.media_blob_id,
          title: song.title,
          artist_name: song.artist_name,
          artist_id: song.artist_id,
          album_title: song.album_title,
          track_number: song.track_number,
          disc_number: song.disc_number,
          duration_seconds: song.duration_seconds,
          year: song.year,
          bpm: song.bpm,
          track_artist: song.track_artist,
          lyrics: song.lyrics,
          metadata: song.metadata,
          images: song.images,
          urls: song.urls,
          album_taxons: song.album_taxons,
          album_images: song.album_images,
          album_tags: song.album_tags,
          artist_images: song.artist_images,
          // narrowed by the guard above (`song.source_type === "remote"
          // && song.remote_server_id`).
          remote_server_id: song.remote_server_id,
          remote_song_id: song.remote_song_id,
          blake3: song.blake3,
          skip_feed_events: song.skip_feed_events,
        });
      } finally {
        removeFromLoadingSet(song.sha256);
      }
      if (!sync.success) {
        throw new BackendPlaybackError(
          this.kind,
          "sync_failed",
          `failed to sync "${song.title}" before rodio playback: ${sync.error ?? "unknown error"}`,
        );
      }
      // prefer the local path the sync returned directly — it's the
      // freshly-written file the local grimoire just produced and
      // doesn't require another db round-trip. fall back to a
      // resolve_blob_path lookup keyed on the *local* media_blob_id
      // (not `song.media_blob_id`, which is the *remote* server's
      // id and won't exist in the local db).
      if (sync.localPath) {
        path = sync.localPath;
      } else if (sync.localMediaBlobId) {
        path = await this.resolveLocalPath(sync.localMediaBlobId);
      } else {
        // last resort: the existing-song shortcut returns no path
        // info, but the song is supposedly already in the db.
        // try the original blob id; if that fails fall back to
        // sha256-based lookup.
        try {
          path = await this.resolveLocalPath(blobId);
        } catch {
          path = await this.resolveLocalPath(song.sha256);
        }
      }
    }

    // optimistically reflect the new song in spume's app state. the
    // facade callers expect `setCurrentSong` to land before audio
    // begins so the UI doesn't briefly show the wrong track.
    bridgeClearExternal();
    await setCurrentSong(song.sha256);

    console.info(
      `[player] rodio loadAndPlay: "${song.title}" (${song.sha256.slice(0, 8)}...) -> ${path}`,
    );

    await this.send({ kind: "load", paths: [path] });
    await this.send({ kind: "play" });
    await this.applyInitialPosition(options);
  }

  /// if the caller passed an `initialPosition` (seconds), seek the
  /// supervisor there. used to resume a paused session on page
  /// reload — the rust side starts every load at 0, so without
  /// this seek the persisted position is lost.
  private async applyInitialPosition(
    options?: LoadAndPlayOptions,
  ): Promise<void> {
    const pos = options?.initialPosition ?? 0;
    if (pos <= 0) return;
    await this.send({ kind: "seek", ms: Math.round(pos * 1000) });
  }

  /// look up the local fs path for a blob via the
  /// `resolve_blob_path` tauri command. throws
  /// `BackendPlaybackError` with a structured `error_type`
  /// discriminant on failure so callers can branch.
  private async resolveLocalPath(blobId: string): Promise<string> {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const result = await invoke<{ id: string; path: string; mime?: string }>(
        "resolve_blob_path",
        { blobId },
      );
      return result.path;
    } catch (e) {
      // the tauri command rejects with `"<error_type>: <message>"` —
      // split the discriminant out so callers can branch on it.
      const raw = e instanceof Error ? e.message : String(e);
      const match = raw.match(/^([a-z_]+):\s*(.+)$/);
      const error_type = match?.[1] ?? "resolve_failed";
      const detail = match?.[2] ?? raw;
      throw new BackendPlaybackError(this.kind, error_type, detail);
    }
  }

  subscribe(listener: PlayerEventListener): Unsubscribe {
    this.listeners.add(listener);
    void this.ensureListening();
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): PlayerSnapshot {
    return this.snap;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.listeners.clear();
    if (this.unlistenPromise) {
      try {
        const unlisten = await this.unlistenPromise;
        unlisten();
      } catch {
        // swallow — disposal is best-effort.
      }
      this.unlistenPromise = null;
    }
    // tear down the queue-watching reconciler. we deliberately do
    // NOT purge the ephemeral dir here: songs still in the persisted
    // queue should keep their on-disk audio across an app restart.
    if (this.disposeReconciler) {
      this.disposeReconciler();
      this.disposeReconciler = null;
    }
  }

  // set up the tauri event listener exactly once. concurrent callers
  // share the same in-flight `listen()` promise.
  private ensureListening(): void {
    if (this.unlistenPromise || this.disposed) {
      return;
    }
    this.unlistenPromise = (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<PlayerEvent>(TAURI_EVENT, (envelope) => {
        const event = envelope.payload;
        this.dispatch(event);
      });
    })();
  }

  // mirror of grimoire's `PlayerSnapshot::apply` so spume callers
  // that read `snapshot()` get fresh data without an extra round-trip.
  // keep this in sync with grimoire/src/player/control.rs.
  private applyToSnapshot(event: PlayerEvent): void {
    switch (event.kind) {
      case "state":
        this.snap = { ...this.snap, state: event.state };
        break;
      case "progress":
        this.snap = {
          ...this.snap,
          position_ms: event.ms,
          total_ms: event.total_ms,
        };
        break;
      case "track_changed":
        this.snap = {
          ...this.snap,
          current_index: event.index,
        };
        break;
      case "ended":
        this.snap = {
          ...this.snap,
          position_ms: 0,
          current_index: null,
        };
        break;
      case "error":
      case "backend_down":
      case "backend_up":
        // these don't shift snapshot fields directly; ui consumers
        // observe them via the listener stream.
        break;
    }
  }

  /// internal `emit` for facade-side synthetic events (e.g. the
  /// pre-load `loading` state that the rust supervisor doesn't
  /// emit). updates the cached snapshot then notifies subscribers,
  /// matching the path tauri events take through `dispatch`.
  private emit(event: PlayerEvent): void {
    this.dispatch(event);
  }

  /// shared dispatch path - used by both the tauri listener and the
  /// internal `emit` helper. updates the cached snapshot then
  /// notifies every subscriber, isolating listener errors so one
  /// bad subscriber doesn't break the chain.
  private dispatch(event: PlayerEvent): void {
    this.applyToSnapshot(event);
    // if the supervisor reports the current track as playable, the
    // user can hear audio — there's no point still showing a row
    // spinner. covers every loadAndPlay branch (ephemeral, sync,
    // already-local, future paths) without each one having to
    // remember to clear the flag itself.
    const sha = this.currentLoadingSha256;
    if (sha) {
      const playable =
        (event.kind === "state" &&
          (event.state === "playing" || event.state === "paused")) ||
        event.kind === "progress";
      if (playable) {
        removeFromLoadingSet(sha);
        this.currentLoadingSha256 = null;
      } else if (event.kind === "error" || event.kind === "ended") {
        // also clear on terminal events so a failed load doesn't
        // leave a permanently-stuck spinner.
        removeFromLoadingSet(sha);
        this.currentLoadingSha256 = null;
      }
    }
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (e) {
        console.error("[rodio backend] listener threw:", e);
      }
    }
  }
}
