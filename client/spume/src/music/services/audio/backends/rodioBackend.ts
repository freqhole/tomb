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
} from "../../download";
import {
  deleteEphemeral,
  fetchEphemeralForSong,
  purgeEphemeralAll,
} from "../ephemeralFetch";
import { clearExternalMediaSession as bridgeClearExternal } from "../mediaSessionBridge";
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

  /// most-recent ephemeral file we fetched, or null. tracked so we
  /// can delete it when (a) a new song loads, (b) the user stops
  /// playback, or (c) the backend is disposed. only set on the
  /// `sync_queue_to_local = false` path — the ON path goes through
  /// the regular media library and isn't ours to clean up.
  private currentEphemeral: { sha256: string; blake3: string; ext: string } | null = null;

  constructor() {
    // defensive: nuke anything left in the ephemeral dir from a
    // previous session (graceful shutdown should have cleared it,
    // but a crash or kill -9 won't have). fire-and-forget; errors
    // are logged inside `purgeEphemeralAll` and shouldn't block
    // backend construction.
    void purgeEphemeralAll();
  }

  async send(cmd: PlayerCommand): Promise<void> {
    if (this.disposed) {
      throw new Error("rodio backend: send called after dispose");
    }
    console.info(`[player] rodio send:`, cmd.kind, cmd);
    // user-initiated stop should drop the current ephemeral file
    // even if no further load happens. we don't hook `pause` —
    // pause is reversible and the user might resume.
    if (cmd.kind === "stop" && this.currentEphemeral) {
      const entry = this.currentEphemeral;
      this.currentEphemeral = null;
      void deleteEphemeral(entry);
    }
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
        // OFF path: fetch the audio into `<fetch_dir>/_ephemeral/`,
        // play it directly from there, and remember it so we can
        // delete it on the next track / stop / dispose. no DB rows
        // are written — mirrors the OFF behavior of `syncSongToLocal`
        // (which also early-returns when the setting is off).
        //
        // delete the *previous* ephemeral file before fetching the
        // new one so we don't accumulate one-per-track on disk
        // during long listening sessions.
        if (this.currentEphemeral) {
          const prev = this.currentEphemeral;
          this.currentEphemeral = null;
          void deleteEphemeral(prev);
        }

        console.info(
          `[player] rodio loadAndPlay: "${song.title}" not on disk yet — fetching ephemerally (sync_queue_to_local=off)`,
        );
        // light up the queue/playerbar spinner for this song while
        // we fetch. mirrors what other audio fetch paths do (see
        // blobResolver / audioAccess / autoDownload).
        addToLoadingSet(song.sha256);
        let fetched;
        try {
          fetched = await fetchEphemeralForSong(song);
        } catch (err) {
          removeFromLoadingSet(song.sha256);
          throw new BackendPlaybackError(
            this.kind,
            "ephemeral_fetch_failed",
            `failed to fetch "${song.title}" ephemerally: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        removeFromLoadingSet(song.sha256);
        path = fetched.path;
        this.currentEphemeral = fetched.entry;

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
          album_genres: song.album_genres,
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
    // clear in-memory tracker first so a racing send/loadAndPlay
    // can't use it after dispose. then nuke the whole ephemeral dir
    // — this is broader than just `currentEphemeral` and catches
    // any file that slipped through cleanup hooks.
    this.currentEphemeral = null;
    void purgeEphemeralAll();
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

  /// shared dispatch path \u2014 used by both the tauri listener and the
  /// internal `emit` helper. updates the cached snapshot then
  /// notifies every subscriber, isolating listener errors so one
  /// bad subscriber doesn't break the chain.
  private dispatch(event: PlayerEvent): void {
    this.applyToSnapshot(event);
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (e) {
        console.error("[rodio backend] listener threw:", e);
      }
    }
  }
}
