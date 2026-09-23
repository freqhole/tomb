import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useAdminTransport } from "../admin/context";

interface RadioStation {
  id: string;
  name: string;
  description: string | null;
  is_public: number; // sqlite bool
  is_enabled: number;
  timeline_only_mode: number; // sqlite bool
  encode_args: string | null;
  codec: string;
  play_mode: string;
  content_mode: string; // 'audio_only' | 'audio_or_video' | 'video_only'
  bumper_frequency_seconds: number | null;
  accepts_requests: number; // sqlite bool - mutually exclusive with is_public
  created_at: number;
  updated_at: number;
}

interface RadioBumper {
  id: string;
  station_id: string;
  song_id: string | null;
  video_id: string | null;
  label: string;
  weight: number;
  created_at: number;
}

interface StationFilter {
  id: string;
  station_id: string;
  filter_type: string;
  filter_value: string;
  filter_label?: string;
  mode: string;
  created_at: number;
}

const REFERENCE_FILTER_TYPES = ["tag", "taxon", "artist", "album", "playlist", "track"] as const;
const CRITERIA_FILTER_TYPES = [
  "favorite",
  "rating_gte",
  "rating_lte",
  "play_count_gte",
  "play_count_lte",
  "duration_gte",
  "duration_lte",
  "added_days_gte",
  "added_days_lte",
] as const;
const FILTER_TYPES = [...REFERENCE_FILTER_TYPES, ...CRITERIA_FILTER_TYPES] as const;
type ReferenceFilterType = (typeof REFERENCE_FILTER_TYPES)[number];
const FILTER_MODES = ["include", "exclude"];

// radio-station-only video filter types (migrations 081/082) - not
// offered anywhere outside radio station seeds (no external-storage sync
// filter-set editor exists in charnel). `video`/`video_series` need a
// suggest lookup like the other reference types; `all_videos` is a
// no-value marker (mirrors `favorite`'s shape) - shuffle across every
// playable video.
const VIDEO_REFERENCE_FILTER_TYPES = ["video", "video_series"] as const;
const VIDEO_ONLY_FILTER_TYPES = ["all_videos"] as const;
const RADIO_FILTER_TYPES = [
  ...FILTER_TYPES,
  ...VIDEO_REFERENCE_FILTER_TYPES,
  ...VIDEO_ONLY_FILTER_TYPES,
] as const;
type RadioFilterType = (typeof RADIO_FILTER_TYPES)[number];
type RadioReferenceFilterType = ReferenceFilterType | (typeof VIDEO_REFERENCE_FILTER_TYPES)[number];

// criteria filters cascade to whole matched albums/artists/playlists (see
// grimoire's radio/stations/repository.rs) — favorite has no value at
// all, rating is clamped 1-5, the rest are plain non-negative integers.
// radio-only counterpart of a plain reference-type check - also matches
// `video`/`video_series`, which need the same suggest-input treatment as
// tag/taxon/artist/album/playlist.
function isRadioReferenceFilterType(t: RadioFilterType): t is RadioReferenceFilterType {
  return (
    (REFERENCE_FILTER_TYPES as readonly string[]).includes(t) ||
    (VIDEO_REFERENCE_FILTER_TYPES as readonly string[]).includes(t)
  );
}

// filter types that take no value at all (mode + type is the whole
// clause) - `favorite` (any of the caller's favorited songs/albums/etc.)
// and `all_videos` (every playable video in the library).
function isNoValueFilterType(t: RadioFilterType): boolean {
  return t === "favorite" || t === "all_videos";
}

function isRatingFilterType(t: RadioFilterType): boolean {
  return t === "rating_gte" || t === "rating_lte";
}

// friendly label for criteria-type filters, which have no filter_label
// from the backend (only reference types get a joined name).
function filterDisplayValue(f: StationFilter): string {
  switch (f.filter_type as RadioFilterType) {
    case "favorite":
      return "favorited (any user)";
    case "all_videos":
      return "every video in the library";
    case "rating_gte":
      return `rating >= ${f.filter_value}`;
    case "rating_lte":
      return `rating <= ${f.filter_value}`;
    case "play_count_gte":
      return `play count >= ${f.filter_value}`;
    case "play_count_lte":
      return `play count <= ${f.filter_value}`;
    case "duration_gte":
      return `duration >= ${f.filter_value}s`;
    case "duration_lte":
      return `duration <= ${f.filter_value}s`;
    case "added_days_gte":
      return `added at least ${f.filter_value}d ago`;
    case "added_days_lte":
      return `added at most ${f.filter_value}d ago`;
    default:
      return f.filter_label && f.filter_label.length > 0 ? f.filter_label : f.filter_value;
  }
}

function stationShallowEqual(a: RadioStation, b: RadioStation): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.description === b.description &&
    a.is_public === b.is_public &&
    a.is_enabled === b.is_enabled &&
    a.timeline_only_mode === b.timeline_only_mode &&
    a.encode_args === b.encode_args &&
    a.codec === b.codec &&
    a.play_mode === b.play_mode &&
    a.content_mode === b.content_mode &&
    a.accepts_requests === b.accepts_requests &&
    a.created_at === b.created_at &&
    a.updated_at === b.updated_at
  );
}

function mergeStations(previous: RadioStation[], next: RadioStation[]): RadioStation[] {
  const prevById = new Map(previous.map((s) => [s.id, s] as const));
  return next.map((incoming) => {
    const prev = prevById.get(incoming.id);
    return prev && stationShallowEqual(prev, incoming) ? prev : incoming;
  });
}

export default function RadioView() {
  const admin = useAdminTransport();
  const [stations, setStations] = createSignal<RadioStation[]>([]);
  const [ffmpegAvailable, setFfmpegAvailable] = createSignal(true);
  const [radioEnabled, setRadioEnabled] = createSignal(true);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [savingId, setSavingId] = createSignal<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = createSignal(false);

  // create form
  const [showCreate, setShowCreate] = createSignal(false);
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [isPublic, setIsPublic] = createSignal(false);
  const [isEnabled, setIsEnabled] = createSignal(true);
  const [acceptsRequests, setAcceptsRequests] = createSignal(false);
  const [playMode, setPlayMode] = createSignal("shuffle");
  const [timelineOnly, setTimelineOnly] = createSignal(false);
  const [contentMode, setContentMode] = createSignal<
    "audio_only" | "audio_or_video" | "video_only"
  >("audio_only");
  // advanced, per-station ffmpeg override - left blank by default so the
  // station inherits the node-wide `[radio].encode_args`/`.video_codec`
  // config (see RadioConfigSection) instead of a value baked in here.
  const [encodeArgs, setEncodeArgs] = createSignal("");
  const [codec, setCodec] = createSignal("");
  const [creating, setCreating] = createSignal(false);

  // per-station seed editor
  const [expandedId, setExpandedId] = createSignal<string | null>(null);

  // per-station inline rename editor
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editName, setEditName] = createSignal("");
  const [editDescription, setEditDescription] = createSignal("");

  // reload whenever the active admin target changes
  createEffect(() => {
    admin.current();
    void loadStations({ forceLoading: true });
  });

  createEffect(() => {
    if (!ffmpegAvailable()) {
      setTimelineOnly(true);
    }
  });

  onMount(() => {
    const interval = window.setInterval(() => {
      // avoid clobbering form state while actively editing.
      if (expandedId() || showCreate()) return;
      void loadStations({ forceLoading: false });
    }, 5000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void loadStations({ forceLoading: false });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    onCleanup(() => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    });
  });

  async function loadStations(options?: { forceLoading?: boolean }) {
    const shouldShowLoading = options?.forceLoading ?? !hasLoadedOnce();
    if (shouldShowLoading) {
      setLoading(true);
    }
    setError("");
    try {
      const [result, cfg] = await Promise.all([
        admin.dispatchOrThrow<RadioStation[]>("radio_stations_list", undefined),
        admin.dispatchOrThrow<RadioConfigPayload>("radio_config_get", undefined),
      ]);
      const nextStations = result ?? [];
      setStations((prev) => mergeStations(prev, nextStations));
      setFfmpegAvailable(cfg.ffmpeg_available !== false);
      setRadioEnabled(cfg.enabled);
      setHasLoadedOnce(true);
    } catch (e) {
      setError(String(e));
    } finally {
      if (shouldShowLoading) {
        setLoading(false);
      }
    }
  }

  async function togglePublic(s: RadioStation) {
    setSavingId(s.id);
    try {
      await admin.dispatchOrThrow("radio_stations_update", {
        id: s.id,
        is_public: !s.is_public,
      });
      await loadStations();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingId(null);
    }
  }

  // mutually exclusive with is_public (server-enforced) - see
  // togglePublic above and repository.rs's effective-value check.
  async function toggleAcceptsRequests(s: RadioStation) {
    setSavingId(s.id);
    try {
      await admin.dispatchOrThrow("radio_stations_update", {
        id: s.id,
        accepts_requests: !s.accepts_requests,
      });
      await loadStations();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingId(null);
    }
  }

  async function toggleEnabled(s: RadioStation) {
    setSavingId(s.id);
    try {
      await admin.dispatchOrThrow("radio_stations_update", {
        id: s.id,
        is_enabled: !s.is_enabled,
      });
      await loadStations();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingId(null);
    }
  }

  async function toggleTimelineOnly(s: RadioStation) {
    const nextTimelineOnly = !s.timeline_only_mode;
    if (!ffmpegAvailable() && !nextTimelineOnly) {
      setError(
        "ffmpeg is not installed on this node, so this station must run in timeline-only mode",
      );
      return;
    }
    setSavingId(s.id);
    try {
      await admin.dispatchOrThrow("radio_stations_update", {
        id: s.id,
        timeline_only_mode: nextTimelineOnly,
      });
      await loadStations();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingId(null);
    }
  }

  function beginEdit(s: RadioStation) {
    setEditingId(s.id);
    setEditName(s.name);
    setEditDescription(s.description ?? "");
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditDescription("");
  }

  async function saveEdit(s: RadioStation) {
    const name = editName().trim();
    if (!name) {
      setError("station name is required");
      return;
    }
    const description = editDescription().trim();
    setSavingId(s.id);
    try {
      // empty string intentionally clears description (COALESCE in the
      // repo only preserves NULL; an empty string overwrites).
      await admin.dispatchOrThrow("radio_stations_update", {
        id: s.id,
        name,
        description,
      });
      cancelEdit();
      await loadStations();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingId(null);
    }
  }

  async function deleteStation(s: RadioStation) {
    if (!confirm(`delete station "${s.name}"? this cannot be undone.`)) return;
    setSavingId(s.id);
    try {
      await admin.dispatchOrThrow("radio_stations_delete", { id: s.id });
      await loadStations();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingId(null);
    }
  }

  async function createStation(e: Event) {
    e.preventDefault();
    if (!name().trim()) {
      setError("station name is required");
      return;
    }
    setCreating(true);
    try {
      await admin.dispatchOrThrow("radio_stations_create", {
        name: name().trim(),
        description: description().trim() || undefined,
        is_public: isPublic(),
        is_enabled: isEnabled(),
        accepts_requests: acceptsRequests(),
        play_mode: playMode(),
        timeline_only_mode: ffmpegAvailable() ? timelineOnly() : true,
        content_mode: contentMode(),
        encode_args: encodeArgs().trim() || undefined,
        codec: codec().trim() || undefined,
      });
      // reset form
      setName("");
      setDescription("");
      setIsPublic(false);
      setIsEnabled(true);
      setAcceptsRequests(false);
      setPlayMode("shuffle");
      setTimelineOnly(!ffmpegAvailable());
      setContentMode("audio_only");
      setEncodeArgs("");
      setCodec("");
      setShowCreate(false);
      await loadStations();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div class="view-content">
      <div class="view-header">
        <h1 class="active">
          radi<span class="pinky">o</span>
        </h1>
      </div>

      <Show when={error()}>
        <p class="error">{error()}</p>
      </Show>

      <RadioConfigSection dispatch={admin.dispatchOrThrow} onEnabledChange={setRadioEnabled} />

      {/* stations section */}
      <Show
        when={radioEnabled()}
        fallback={
          <div class="section">
            <p class="item-meta">radio is disabled.</p>
          </div>
        }
      >
        <div class="section">
          <div class="section-header">
            <h2>
              station<span class="pinky">z</span>
            </h2>
            <Show when={!showCreate()}>
              <button
                class="primary small"
                onClick={() => setShowCreate((v) => !v)}
                disabled={creating()}
              >
                + new station
              </button>
            </Show>
          </div>

          {/* create form */}
          <Show when={showCreate()}>
            <form class="card" onSubmit={createStation}>
              <div class="form-row">
                <label>
                  <span class="label">name</span>
                  <input
                    type="text"
                    value={name()}
                    onInput={(e) => setName(e.currentTarget.value)}
                    placeholder="late night jams"
                    required
                  />
                </label>
              </div>
              <div class="form-row">
                <label>
                  <span class="label">description (optional)</span>
                  <input
                    type="text"
                    value={description()}
                    onInput={(e) => setDescription(e.currentTarget.value)}
                    placeholder="ambient + downtempo"
                  />
                </label>
              </div>
              <div class="form-row" style={{ display: "flex", gap: "1.5rem", "flex-wrap": "wrap" }}>
                <label
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    "align-items": "center",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isPublic()}
                    onChange={(e) => {
                      const checked = e.currentTarget.checked;
                      setIsPublic(checked);
                      if (checked) setAcceptsRequests(false);
                    }}
                  />
                  <span>public (visible to anyone who has the link)</span>
                </label>
                <label
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    "align-items": "center",
                  }}
                  title={
                    isPublic() ? "a public station can't also take member requests" : undefined
                  }
                >
                  <input
                    type="checkbox"
                    checked={acceptsRequests()}
                    disabled={isPublic()}
                    onChange={(e) => setAcceptsRequests(e.currentTarget.checked)}
                  />
                  <span>accepts member requests (mutually exclusive with public)</span>
                </label>
                <label
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    "align-items": "center",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isEnabled()}
                    onChange={(e) => setIsEnabled(e.currentTarget.checked)}
                  />
                  <span>enabled</span>
                </label>
                <label
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    "align-items": "center",
                  }}
                >
                  <span>play mode</span>
                  <select value={playMode()} onChange={(e) => setPlayMode(e.currentTarget.value)}>
                    <option value="shuffle">shuffle</option>
                    <option value="album">album</option>
                  </select>
                </label>
                <label
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    "align-items": "center",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!timelineOnly()}
                    onChange={(e) => setTimelineOnly(!e.currentTarget.checked)}
                    disabled={!ffmpegAvailable()}
                  />
                  <span>ffmpeg chunk mode (uncheck for timeline-only mode)</span>
                </label>
                <label
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    "align-items": "center",
                  }}
                >
                  <span>content</span>
                  <select
                    value={contentMode()}
                    onChange={(e) =>
                      setContentMode(
                        e.currentTarget.value as "audio_only" | "audio_or_video" | "video_only",
                      )
                    }
                  >
                    <option value="audio_only">audio only</option>
                    <option value="audio_or_video">audio + video</option>
                    <option value="video_only">video only</option>
                  </select>
                </label>
              </div>
              <Show when={!ffmpegAvailable()}>
                <p class="item-meta">
                  ffmpeg is not installed on this node; stations will run in timeline-only mode.
                </p>
              </Show>
              <details class="card">
                <summary style={{ cursor: "pointer" }}>
                  advanced: per-station ffmpeg override
                </summary>
                <div
                  style={{
                    display: "flex",
                    "flex-direction": "column",
                    gap: "0.6rem",
                    "margin-top": "0.6rem",
                  }}
                >
                  <p class="item-meta">
                    leave blank to use this node's <code>[radio]</code> config defaults (see "radio
                    config" above) - a video-capable content mode already gets a video-carrying
                    encode from there automatically. only set these if THIS station specifically
                    needs a different ffmpeg encode or codec than the node default.
                  </p>
                  <label>
                    <span class="label">codec (MSE SourceBuffer mime type)</span>
                    <input
                      type="text"
                      value={codec()}
                      onInput={(e) => setCodec(e.currentTarget.value)}
                      placeholder="(inherit from node config)"
                    />
                  </label>
                  <label>
                    <span class="label">encode args (ffmpeg, {"{input}"} placeholder)</span>
                    <textarea
                      rows={3}
                      value={encodeArgs()}
                      onInput={(e) => setEncodeArgs(e.currentTarget.value)}
                      placeholder="(inherit from node config)"
                    />
                  </label>
                </div>
              </details>
              <div class="form-row" style={{ display: "flex", gap: "0.5rem" }}>
                <button type="submit" class="primary small" disabled={creating()}>
                  {creating() ? "creating..." : "create station"}
                </button>
                <button
                  type="button"
                  class="secondary small"
                  onClick={() => setShowCreate(false)}
                  disabled={creating()}
                >
                  cancel
                </button>
              </div>
            </form>
          </Show>

          <div style={{ "margin-bottom": "1.25rem" }} />

          <Show when={loading()}>
            <div class="loading">
              <div class="spinner" />
              <span class="active">
                loading station<span class="pinky">z</span>...
              </span>
            </div>
          </Show>

          <Show when={!loading()}>
            <Show when={stations().length === 0}>
              <p class="empty active">
                no station<span class="pinky">z</span> configured yet
              </p>
            </Show>

            <For each={stations()}>
              {(s) => (
                <>
                  <div
                    class="list-item"
                    style={{
                      "flex-direction": "column",
                      "align-items": "stretch",
                      gap: "0.4rem",
                      padding: "0.65rem 0.75rem",
                    }}
                  >
                    {/* name + description */}
                    <div
                      style={{
                        display: "flex",
                        "align-items": "baseline",
                        gap: "0.5rem",
                        "flex-wrap": "wrap",
                      }}
                    >
                      <Show
                        when={editingId() === s.id}
                        fallback={
                          <>
                            <strong>{s.name}</strong>
                            <Show when={s.description}>
                              <span class="item-meta" style={{ "font-size": "0.8rem" }}>
                                {s.description}
                              </span>
                            </Show>
                            <button
                              class="secondary small"
                              style={{
                                "font-size": "0.72rem",
                                "margin-left": "auto",
                              }}
                              onClick={() => beginEdit(s)}
                              disabled={savingId() === s.id}
                              title="rename station"
                            >
                              rename
                            </button>
                          </>
                        }
                      >
                        <input
                          type="text"
                          value={editName()}
                          onInput={(e) => setEditName(e.currentTarget.value)}
                          placeholder="station name"
                          style={{ flex: "1 1 12rem" }}
                          disabled={savingId() === s.id}
                        />
                        <input
                          type="text"
                          value={editDescription()}
                          onInput={(e) => setEditDescription(e.currentTarget.value)}
                          placeholder="description (optional)"
                          style={{ flex: "2 1 16rem" }}
                          disabled={savingId() === s.id}
                        />
                        <button
                          class="primary small"
                          onClick={() => saveEdit(s)}
                          disabled={savingId() === s.id || !editName().trim()}
                          title="save changes"
                        >
                          save
                        </button>
                        <button
                          class="secondary small"
                          onClick={cancelEdit}
                          disabled={savingId() === s.id}
                          title="discard changes"
                        >
                          cancel
                        </button>
                      </Show>
                    </div>
                    {/* toggle row */}
                    <div
                      style={{
                        display: "flex",
                        gap: "0.35rem",
                        "flex-wrap": "wrap",
                        "align-items": "center",
                      }}
                    >
                      <button
                        class={s.is_public ? "primary small" : "secondary small"}
                        onClick={() => togglePublic(s)}
                        disabled={savingId() === s.id || (!s.is_public && !!s.accepts_requests)}
                        title={
                          !s.is_public && s.accepts_requests
                            ? "a request-taking station can't also be public"
                            : s.is_public
                              ? "make private"
                              : "make public"
                        }
                      >
                        {s.is_public ? "public" : "private"}
                      </button>
                      <button
                        class={s.accepts_requests ? "primary small" : "secondary small"}
                        onClick={() => toggleAcceptsRequests(s)}
                        disabled={savingId() === s.id || (!s.accepts_requests && !!s.is_public)}
                        title={
                          !s.accepts_requests && s.is_public
                            ? "a public station can't also take member requests"
                            : s.accepts_requests
                              ? "stop taking member requests"
                              : "start taking member requests"
                        }
                      >
                        {s.accepts_requests ? "requests on" : "requests off"}
                      </button>
                      <button
                        class={s.is_enabled ? "primary small" : "secondary small"}
                        onClick={() => toggleEnabled(s)}
                        disabled={savingId() === s.id}
                        title={s.is_enabled ? "disable station" : "enable station"}
                      >
                        {s.is_enabled ? "enabled" : "disabled"}
                      </button>
                      <button
                        class={!s.timeline_only_mode ? "primary small" : "secondary small"}
                        onClick={() => toggleTimelineOnly(s)}
                        disabled={savingId() === s.id}
                        title={
                          !ffmpegAvailable()
                            ? "ffmpeg is unavailable on this node"
                            : s.timeline_only_mode
                              ? "switch to ffmpeg chunk streaming"
                              : "switch to timeline-only mode (no ffmpeg)"
                        }
                      >
                        ffmpeg
                      </button>
                      <select
                        style={{ "font-size": "0.78rem" }}
                        value={s.play_mode === "album" ? "album" : "shuffle"}
                        disabled={savingId() === s.id}
                        onChange={async (e) => {
                          setSavingId(s.id);
                          try {
                            await admin.dispatchOrThrow("radio_stations_update", {
                              id: s.id,
                              play_mode: e.currentTarget.value,
                            });
                            await loadStations();
                          } catch (err) {
                            setError(String(err));
                          } finally {
                            setSavingId(null);
                          }
                        }}
                      >
                        <option value="shuffle">shuffle</option>
                        <option value="album">album</option>
                      </select>
                      <select
                        style={{ "font-size": "0.78rem" }}
                        value={s.content_mode || "audio_only"}
                        disabled={savingId() === s.id}
                        title="content mode"
                        onChange={async (e) => {
                          setSavingId(s.id);
                          try {
                            await admin.dispatchOrThrow("radio_stations_update", {
                              id: s.id,
                              content_mode: e.currentTarget.value,
                            });
                            await loadStations();
                          } catch (err) {
                            setError(String(err));
                          } finally {
                            setSavingId(null);
                          }
                        }}
                      >
                        <option value="audio_only">audio only</option>
                        <option value="audio_or_video">audio + video</option>
                        <option value="video_only">video only</option>
                      </select>
                      <button
                        class="danger small"
                        onClick={() => deleteStation(s)}
                        disabled={savingId() === s.id}
                        style={{ "margin-left": "auto" }}
                      >
                        delete
                      </button>
                    </div>
                    {/* seed editor toggle */}
                    <div>
                      <button
                        class="secondary small"
                        style={{ "font-size": "0.72rem", opacity: "0.75" }}
                        onClick={() => setExpandedId((cur) => (cur === s.id ? null : s.id))}
                      >
                        {expandedId() === s.id ? "▴ hide seed" : "▾ edit seed"}
                      </button>
                    </div>
                  </div>
                  <Show when={expandedId() === s.id}>
                    <StationSeedEditor stationId={s.id} dispatch={admin.dispatchOrThrow} />
                    <StationBumperEditor
                      stationId={s.id}
                      dispatch={admin.dispatchOrThrow}
                      frequencySeconds={s.bumper_frequency_seconds}
                    />
                    <StationEncodeOverrideEditor
                      stationId={s.id}
                      dispatch={admin.dispatchOrThrow}
                      encodeArgs={s.encode_args ?? ""}
                      codec={s.codec}
                      onSaved={() => loadStations()}
                    />
                  </Show>
                </>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}

type Dispatch = <T = unknown>(command: string, args?: unknown) => Promise<T>;

interface StationSeedEditorProps {
  stationId: string;
  dispatch: Dispatch;
}

function StationSeedEditor(props: StationSeedEditorProps) {
  const [filters, setFilters] = createSignal<StationFilter[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  // add-filter form
  const [fType, setFType] = createSignal<RadioFilterType>("tag");
  const [fValue, setFValue] = createSignal("");
  const [fMode, setFMode] = createSignal("include");

  createEffect(() => {
    // re-run when stationId changes
    void props.stationId;
    void load();
  });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const fs = await props.dispatch<StationFilter[]>("radio_filters_list", {
        station_id: props.stationId,
      });
      setFilters(fs ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function addFilter(e: Event) {
    e.preventDefault();
    if (!isNoValueFilterType(fType()) && !fValue().trim()) {
      setError("filter value required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await props.dispatch("radio_filters_add", {
        station_id: props.stationId,
        filter_type: fType(),
        filter_value: isNoValueFilterType(fType()) ? "" : fValue().trim(),
        mode: fMode(),
      });
      setFValue("");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeFilter(filterId: string) {
    setBusy(true);
    setError("");
    try {
      await props.dispatch("radio_filters_remove", { filter_id: filterId });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      class="card"
      style={{
        "margin-bottom": "0.5rem",
        "border-left": "3px solid #6f5fbd",
        padding: "0.75rem",
      }}
    >
      <Show when={error()}>
        <p class="error" style={{ "margin-top": 0 }}>
          {error()}
        </p>
      </Show>

      <Show when={loading()}>
        <p class="item-meta">loading seed...</p>
      </Show>

      <Show when={!loading()}>
        {/* filters */}
        <div style={{ "margin-bottom": "0.5rem" }}>
          <For each={filters()}>
            {(f) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "0.4rem",
                  padding: "0.2rem 0",
                  "border-bottom": "1px solid #222",
                }}
              >
                <span
                  class="badge"
                  style={{
                    background: f.mode === "include" ? "#1f6f43" : "#6f1f1f",
                    color: f.mode === "include" ? "#a7e8c5" : "#e8a7a7",
                    "font-size": "0.7rem",
                    padding: "0.1rem 0.35rem",
                  }}
                >
                  {f.mode}
                </span>
                <code style={{ "font-size": "0.78rem" }}>{f.filter_type}</code>
                <span style={{ color: "#666", "font-size": "0.75rem" }}>=</span>
                <span
                  style={{
                    "font-size": "0.78rem",
                    flex: "1",
                    overflow: "hidden",
                    "text-overflow": "ellipsis",
                    "white-space": "nowrap",
                  }}
                  title={f.filter_value}
                >
                  {filterDisplayValue(f)}
                </span>
                <button
                  class="danger small"
                  style={{ padding: "0.1rem 0.4rem", "font-size": "0.75rem" }}
                  onClick={() => removeFilter(f.id)}
                  disabled={busy()}
                >
                  ×
                </button>
              </div>
            )}
          </For>
          <Show when={filters().length === 0}>
            <p class="item-meta" style={{ margin: "0.25rem 0", "font-size": "0.78rem" }}>
              no filters
            </p>
          </Show>
        </div>
        <form
          onSubmit={addFilter}
          style={{
            display: "flex",
            gap: "0.35rem",
            "margin-bottom": "0.75rem",
            "flex-wrap": "wrap",
            "align-items": "flex-end",
          }}
        >
          <select
            value={fMode()}
            onChange={(e) => setFMode(e.currentTarget.value)}
            style={{ "font-size": "0.8rem" }}
          >
            <For each={FILTER_MODES}>{(m) => <option value={m}>{m}</option>}</For>
          </select>
          <select
            value={fType()}
            onChange={(e) => {
              setFType(e.currentTarget.value as RadioFilterType);
              setFValue("");
            }}
            style={{ "font-size": "0.8rem" }}
          >
            <optgroup label="reference">
              <For each={REFERENCE_FILTER_TYPES}>{(t) => <option value={t}>{t}</option>}</For>
              <For each={VIDEO_REFERENCE_FILTER_TYPES}>{(t) => <option value={t}>{t}</option>}</For>
            </optgroup>
            <optgroup label="video library">
              <For each={VIDEO_ONLY_FILTER_TYPES}>{(t) => <option value={t}>{t}</option>}</For>
            </optgroup>
            <optgroup label="criteria (any user)">
              <For each={CRITERIA_FILTER_TYPES}>{(t) => <option value={t}>{t}</option>}</For>
            </optgroup>
          </select>
          <Show when={isRadioReferenceFilterType(fType())}>
            <Show
              when={fType() === "track"}
              fallback={
                <SeedSuggestInput
                  kind={
                    fType() as
                      "tag" | "taxon" | "artist" | "album" | "playlist" | "video" | "video_series"
                  }
                  value={fValue()}
                  onChange={setFValue}
                  dispatch={props.dispatch}
                  placeholder={`${fType()} name`}
                />
              }
            >
              <SongSuggestInput value={fValue()} onChange={setFValue} dispatch={props.dispatch} />
            </Show>
          </Show>
          <Show when={isNoValueFilterType(fType())}>
            <span class="item-meta" style={{ "font-size": "0.75rem" }}>
              no value needed
            </span>
          </Show>
          <Show when={!isRadioReferenceFilterType(fType()) && !isNoValueFilterType(fType())}>
            <input
              type="number"
              min={isRatingFilterType(fType()) ? 1 : 0}
              max={isRatingFilterType(fType()) ? 5 : undefined}
              step={1}
              placeholder={isRatingFilterType(fType()) ? "1-5" : "0"}
              value={fValue()}
              onInput={(e) => setFValue(e.currentTarget.value)}
              style={{ "font-size": "0.8rem", width: "5rem" }}
            />
          </Show>
          <button type="submit" class="primary small" disabled={busy()}>
            + add filter
          </button>
        </form>
      </Show>
    </div>
  );
}

interface StationBumperEditorProps {
  stationId: string;
  dispatch: Dispatch;
  frequencySeconds: number | null;
}

function StationBumperEditor(props: StationBumperEditorProps) {
  const [bumpers, setBumpers] = createSignal<RadioBumper[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const [bKind, setBKind] = createSignal<"song" | "video">("song");
  const [bValue, setBValue] = createSignal("");
  const [bLabel, setBLabel] = createSignal("");
  const [bWeight, setBWeight] = createSignal(1);
  const [freq, setFreq] = createSignal(props.frequencySeconds?.toString() ?? "");
  const [freqBusy, setFreqBusy] = createSignal(false);

  createEffect(() => {
    void props.stationId;
    void load();
  });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const bs = await props.dispatch<RadioBumper[]>("radio_bumpers_list", {
        station_id: props.stationId,
      });
      setBumpers(bs ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function addBumper(e: Event) {
    e.preventDefault();
    if (!bValue().trim()) {
      setError(`pick a ${bKind()} for this bumper`);
      return;
    }
    if (!bLabel().trim()) {
      setError("bumper label required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await props.dispatch("radio_bumpers_add", {
        station_id: props.stationId,
        song_id: bKind() === "song" ? bValue().trim() : null,
        video_id: bKind() === "video" ? bValue().trim() : null,
        label: bLabel().trim(),
        weight: bWeight(),
      });
      setBValue("");
      setBLabel("");
      setBWeight(1);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeBumper(bumperId: string) {
    setBusy(true);
    setError("");
    try {
      await props.dispatch("radio_bumpers_remove", { bumper_id: bumperId });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveFrequency(e: Event) {
    e.preventDefault();
    setFreqBusy(true);
    setError("");
    try {
      const trimmed = freq().trim();
      const frequency_seconds = trimmed === "" ? null : Number(trimmed);
      await props.dispatch("radio_bumpers_set_frequency", {
        station_id: props.stationId,
        frequency_seconds,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setFreqBusy(false);
    }
  }

  return (
    <div
      class="card"
      style={{
        "margin-bottom": "0.5rem",
        "border-left": "3px solid #bd5f8f",
        padding: "0.75rem",
      }}
    >
      <Show when={error()}>
        <p class="error" style={{ "margin-top": 0 }}>
          {error()}
        </p>
      </Show>
      <Show when={loading()}>
        <p class="item-meta">loading bumpers...</p>
      </Show>
      <Show when={!loading()}>
        <form
          onSubmit={saveFrequency}
          style={{
            display: "flex",
            gap: "0.4rem",
            "align-items": "flex-end",
            "margin-bottom": "0.6rem",
          }}
        >
          <label style={{ display: "flex", "flex-direction": "column", gap: "0.2rem" }}>
            <span class="item-meta" style={{ "font-size": "0.72rem" }}>
              play a bumper every N seconds (blank = off)
            </span>
            <input
              type="number"
              min="0"
              value={freq()}
              onInput={(e) => setFreq(e.currentTarget.value)}
              style={{ "font-size": "0.8rem", width: "8rem" }}
            />
          </label>
          <button type="submit" class="primary small" disabled={freqBusy()}>
            save cadence
          </button>
        </form>

        <div style={{ "margin-bottom": "0.5rem" }}>
          <For each={bumpers()}>
            {(b) => (
              <div
                style={{
                  display: "flex",
                  "align-items": "center",
                  gap: "0.4rem",
                  padding: "0.2rem 0",
                  "border-bottom": "1px solid #222",
                }}
              >
                <span
                  class="badge"
                  style={{
                    background: b.video_id ? "#4a3a7a" : "#1f4f6f",
                    color: b.video_id ? "#c7b8ff" : "#a7d5e8",
                    "font-size": "0.7rem",
                    padding: "0.1rem 0.35rem",
                  }}
                >
                  {b.video_id ? "video" : "song"}
                </span>
                <span style={{ "font-size": "0.78rem", flex: "1" }}>{b.label}</span>
                <span class="item-meta" style={{ "font-size": "0.72rem" }}>
                  weight {b.weight}
                </span>
                <button
                  class="danger small"
                  style={{ padding: "0.1rem 0.4rem", "font-size": "0.75rem" }}
                  onClick={() => removeBumper(b.id)}
                  disabled={busy()}
                >
                  ×
                </button>
              </div>
            )}
          </For>
          <Show when={bumpers().length === 0}>
            <p class="item-meta" style={{ margin: "0.25rem 0", "font-size": "0.78rem" }}>
              no bumpers
            </p>
          </Show>
        </div>

        <form
          onSubmit={addBumper}
          style={{
            display: "flex",
            gap: "0.35rem",
            "flex-wrap": "wrap",
            "align-items": "flex-end",
          }}
        >
          <select
            value={bKind()}
            onChange={(e) => {
              setBKind(e.currentTarget.value as "song" | "video");
              setBValue("");
            }}
            style={{ "font-size": "0.8rem" }}
          >
            <option value="song">song</option>
            <option value="video">video</option>
          </select>
          <Show
            when={bKind() === "song"}
            fallback={
              <SeedSuggestInput
                kind="video"
                value={bValue()}
                onChange={setBValue}
                dispatch={props.dispatch}
                placeholder="video title"
              />
            }
          >
            <SongSuggestInput value={bValue()} onChange={setBValue} dispatch={props.dispatch} />
          </Show>
          <input
            type="text"
            placeholder="label (e.g. station id)"
            value={bLabel()}
            onInput={(e) => setBLabel(e.currentTarget.value)}
            style={{ "font-size": "0.8rem" }}
          />
          <input
            type="number"
            min="1"
            title="weight (higher = picked more often)"
            value={bWeight()}
            onInput={(e) => setBWeight(e.currentTarget.valueAsNumber || 1)}
            style={{ "font-size": "0.8rem", width: "4rem" }}
          />
          <button type="submit" class="primary small" disabled={busy()}>
            + add bumper
          </button>
        </form>
      </Show>
    </div>
  );
}

interface StationEncodeOverrideEditorProps {
  stationId: string;
  dispatch: Dispatch;
  encodeArgs: string;
  codec: string;
  onSaved: () => void | Promise<void>;
}

// per-station ffmpeg override (codec + encode args) - see
// `RadioStation.encode_args`'s doc comment in grimoire for why the
// override is nullable but "clear" from this form sends an empty
// string (the only way `radio_stations_update`'s COALESCE can revert
// it to the node-wide default).
function StationEncodeOverrideEditor(props: StationEncodeOverrideEditorProps) {
  const [encodeArgs, setEncodeArgs] = createSignal(props.encodeArgs);
  const [codec, setCodec] = createSignal(props.codec);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");

  async function save(e: Event) {
    e.preventDefault();
    if (!codec().trim()) {
      setError("codec is required (station playback breaks without one)");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await props.dispatch("radio_stations_update", {
        id: props.stationId,
        encode_args: encodeArgs().trim(),
        codec: codec().trim(),
      });
      await props.onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      class="card"
      style={{
        "margin-bottom": "0.5rem",
        "border-left": "3px solid #bd5f8f",
        padding: "0.75rem",
      }}
    >
      <p class="item-meta" style={{ "margin-top": 0 }}>
        per-station ffmpeg override - leave "encode args" blank to inherit this node's default for
        this station's content mode (see "radio config" above).
      </p>
      <Show when={error()}>
        <p class="error" style={{ "margin-top": 0 }}>
          {error()}
        </p>
      </Show>
      <form onSubmit={save} style={{ display: "flex", "flex-direction": "column", gap: "0.5rem" }}>
        <label>
          <span class="label">codec (MSE SourceBuffer mime type)</span>
          <input
            type="text"
            value={codec()}
            onInput={(e) => setCodec(e.currentTarget.value)}
            disabled={busy()}
          />
        </label>
        <label>
          <span class="label">encode args (ffmpeg, {"{input}"} placeholder)</span>
          <textarea
            rows={3}
            value={encodeArgs()}
            onInput={(e) => setEncodeArgs(e.currentTarget.value)}
            placeholder="(inherit from node config)"
            disabled={busy()}
          />
        </label>
        <div>
          <button type="submit" class="primary small" disabled={busy()}>
            {busy() ? "saving..." : "save"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------
// seed value autocomplete helpers (mirror of spume RadioAdminView)
// ------------------------------------------------------------------
//
// debounced datalist-driven inputs that query `radio_seed_suggest` over
// the active wizard transport so suggestions come from whatever node
// the wizard is currently targeting.

interface RadioSeedSuggestion {
  id: string;
  name: string;
  subtitle?: string | null;
}

interface SeedSuggestInputProps {
  kind: "tag" | "taxon" | "artist" | "album" | "playlist" | "video" | "video_series";
  value: string;
  onChange: (v: string) => void;
  dispatch: Dispatch;
  placeholder?: string;
}

function SeedSuggestInput(props: SeedSuggestInputProps) {
  const listId = `seed-suggest-${Math.random().toString(36).slice(2, 9)}`;
  const [items, setItems] = createSignal<RadioSeedSuggestion[]>([]);
  const [text, setText] = createSignal("");
  let timer: number | null = null;

  // when the parent clears `value` (e.g. after a successful submit, or
  // when the filter type switches), wipe the visible text too.
  createEffect(() => {
    if (props.value === "") setText("");
  });

  const fetchSuggestions = (q: string) => {
    if (timer !== null) window.clearTimeout(timer);
    if (q.trim().length === 0) {
      setItems([]);
      return;
    }
    timer = window.setTimeout(async () => {
      try {
        const data = await props.dispatch<RadioSeedSuggestion[]>("radio_seed_suggest", {
          kind: props.kind,
          query: q.trim(),
          limit: 15,
        });
        setItems(data ?? []);
      } catch {
        setItems([]);
      }
    }, 200);
  };

  // map the typed text back to the suggestion's id when there's an exact
  // name match. server requires real FK ids now — we never round-trip
  // names back to the api.
  const resolve = (typed: string) => {
    const match = items().find((it) => it.name === typed);
    if (match) {
      props.onChange(match.id);
    } else {
      props.onChange("");
    }
  };

  onCleanup(() => {
    if (timer !== null) window.clearTimeout(timer);
  });

  return (
    <>
      <input
        type="text"
        list={listId}
        value={text()}
        placeholder={props.placeholder ?? "value"}
        autocomplete="off"
        style={{ flex: "1", "min-width": "10rem" }}
        onInput={(e) => {
          setText(e.currentTarget.value);
          fetchSuggestions(e.currentTarget.value);
          resolve(e.currentTarget.value);
        }}
        onFocus={(e) => fetchSuggestions(e.currentTarget.value)}
      />
      <datalist id={listId}>
        <For each={items()}>{(it) => <option value={it.name}>{it.subtitle ?? ""}</option>}</For>
      </datalist>
    </>
  );
}

interface SongSuggestInputProps {
  value: string;
  onChange: (songId: string) => void;
  dispatch: Dispatch;
}

function SongSuggestInput(props: SongSuggestInputProps) {
  const listId = `song-suggest-${Math.random().toString(36).slice(2, 9)}`;
  const [items, setItems] = createSignal<RadioSeedSuggestion[]>([]);
  const [text, setText] = createSignal("");
  let timer: number | null = null;

  createEffect(() => {
    if (props.value === "") setText("");
  });

  const fetchSuggestions = (q: string) => {
    if (timer !== null) window.clearTimeout(timer);
    if (q.trim().length === 0) {
      setItems([]);
      return;
    }
    timer = window.setTimeout(async () => {
      try {
        const data = await props.dispatch<RadioSeedSuggestion[]>("radio_seed_suggest", {
          kind: "song",
          query: q.trim(),
          limit: 15,
        });
        setItems(data ?? []);
      } catch {
        setItems([]);
      }
    }, 200);
  };

  const resolve = (typed: string) => {
    const match = items().find((it) => it.name === typed);
    props.onChange(match ? match.id : typed.trim());
  };

  onCleanup(() => {
    if (timer !== null) window.clearTimeout(timer);
  });

  return (
    <>
      <input
        type="text"
        list={listId}
        value={text()}
        placeholder="song title or uuid"
        autocomplete="off"
        style={{ flex: "1" }}
        onInput={(e) => {
          setText(e.currentTarget.value);
          fetchSuggestions(e.currentTarget.value);
          resolve(e.currentTarget.value);
        }}
        onFocus={(e) => fetchSuggestions(e.currentTarget.value)}
      />
      <datalist id={listId}>
        <For each={items()}>{(it) => <option value={it.name}>{it.subtitle ?? ""}</option>}</For>
      </datalist>
    </>
  );
}

// ------------------------------------------------------------------
// node-wide [radio] config editor
// ------------------------------------------------------------------

interface RadioConfigPayload {
  enabled: boolean;
  encode_args?: string;
  video_encode_args?: string;
  video_codec?: string;
  ffmpeg_available?: boolean;
  max_concurrent_audio_streams?: number;
  max_concurrent_video_streams?: number;
}

interface RadioConfigSectionProps {
  dispatch: Dispatch;
  onEnabledChange?: (enabled: boolean) => void;
}

function RadioConfigSection(props: RadioConfigSectionProps) {
  const [enabled, setEnabled] = createSignal(false);
  const [encodeArgs, setEncodeArgs] = createSignal("");
  const [videoEncodeArgs, setVideoEncodeArgs] = createSignal("");
  const [videoCodec, setVideoCodec] = createSignal("");
  // last-loaded values, so a save only sends an encode-arg field the
  // operator actually edited - otherwise every save (even just toggling
  // "enabled" or a concurrency limit) would re-freeze whatever's
  // currently displayed (often just the live default) as a literal toml
  // override, permanently opting the field out of future default fixes.
  const [loadedEncodeArgs, setLoadedEncodeArgs] = createSignal("");
  const [loadedVideoEncodeArgs, setLoadedVideoEncodeArgs] = createSignal("");
  const [loadedVideoCodec, setLoadedVideoCodec] = createSignal("");
  const [maxConcurrentAudioStreams, setMaxConcurrentAudioStreams] = createSignal(2);
  const [maxConcurrentVideoStreams, setMaxConcurrentVideoStreams] = createSignal(1);
  const [loading, setLoading] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal("");

  // `undefined` unless the field differs from what was last loaded (and
  // isn't blank) - see the field-tracking comment above.
  function dirtyOrUndefined(current: string, loaded: string): string | undefined {
    const trimmed = current.trim();
    return trimmed !== "" && trimmed !== loaded ? trimmed : undefined;
  }

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const cfg = await props.dispatch<RadioConfigPayload>("radio_config_get", undefined);
      setEnabled(cfg.enabled);
      setEncodeArgs(cfg.encode_args ?? "");
      setVideoEncodeArgs(cfg.video_encode_args ?? "");
      setVideoCodec(cfg.video_codec ?? "");
      setLoadedEncodeArgs(cfg.encode_args ?? "");
      setLoadedVideoEncodeArgs(cfg.video_encode_args ?? "");
      setLoadedVideoCodec(cfg.video_codec ?? "");
      setMaxConcurrentAudioStreams(cfg.max_concurrent_audio_streams ?? 2);
      setMaxConcurrentVideoStreams(cfg.max_concurrent_video_streams ?? 1);
      props.onEnabledChange?.(cfg.enabled);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  createEffect(() => {
    void load();
  });

  // toggling the main switch immediately persists the new value to
  // freqhole-config.toml. everything else is passed through unchanged.
  async function toggleEnabled(next: boolean) {
    const prev = enabled();
    setEnabled(next);
    setBusy(true);
    setErr("");
    try {
      await props.dispatch<RadioConfigPayload>("radio_config_set", {
        enabled: next,
        encode_args: dirtyOrUndefined(encodeArgs(), loadedEncodeArgs()),
        video_encode_args: dirtyOrUndefined(videoEncodeArgs(), loadedVideoEncodeArgs()),
        video_codec: dirtyOrUndefined(videoCodec(), loadedVideoCodec()),
        max_concurrent_audio_streams: maxConcurrentAudioStreams(),
        max_concurrent_video_streams: maxConcurrentVideoStreams(),
      });
      props.onEnabledChange?.(next);
      await load();
    } catch (e) {
      setEnabled(prev);
      props.onEnabledChange?.(prev);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const [savingEncode, setSavingEncode] = createSignal(false);
  async function saveEncode(e?: Event) {
    e?.preventDefault();
    setSavingEncode(true);
    setErr("");
    try {
      await props.dispatch<RadioConfigPayload>("radio_config_set", {
        enabled: enabled(),
        encode_args: dirtyOrUndefined(encodeArgs(), loadedEncodeArgs()),
        video_encode_args: dirtyOrUndefined(videoEncodeArgs(), loadedVideoEncodeArgs()),
        video_codec: dirtyOrUndefined(videoCodec(), loadedVideoCodec()),
        max_concurrent_audio_streams: maxConcurrentAudioStreams(),
        max_concurrent_video_streams: maxConcurrentVideoStreams(),
      });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingEncode(false);
    }
  }

  return (
    <div class="section">
      <div class="section-header">
        <h2>
          radio confi<span class="pinky">g</span>
        </h2>
      </div>
      <Show when={err()}>
        <p class="error">{err()}</p>
      </Show>
      <Show when={loading()} fallback={null}>
        <p class="item-meta">loading config...</p>
      </Show>
      <Show when={!loading()}>
        <div class="card">
          <div
            style={{
              display: "flex",
              "align-items": "center",
              gap: "0.5rem",
              "margin-bottom": "0.6rem",
            }}
          >
            <button
              type="button"
              class={enabled() ? "primary small" : "secondary small"}
              onClick={() => void toggleEnabled(!enabled())}
              disabled={busy()}
            >
              {enabled() ? "radio enabled" : "radio disabled"}
            </button>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", "margin-bottom": "0.6rem" }}>
            <label style={{ flex: "1" }}>
              <span class="label">max concurrent audio streams</span>
              <input
                type="number"
                min="0"
                value={maxConcurrentAudioStreams()}
                onInput={(e) => setMaxConcurrentAudioStreams(e.currentTarget.valueAsNumber || 0)}
                onBlur={() => void saveEncode()}
              />
            </label>
            <label style={{ flex: "1" }}>
              <span class="label">max concurrent video streams</span>
              <input
                type="number"
                min="0"
                value={maxConcurrentVideoStreams()}
                onInput={(e) => setMaxConcurrentVideoStreams(e.currentTarget.valueAsNumber || 0)}
                onBlur={() => void saveEncode()}
              />
            </label>
          </div>
          <details>
            <summary style={{ cursor: "pointer" }}>advanced: node-wide ffmpeg defaults</summary>
            <form
              onSubmit={saveEncode}
              style={{
                display: "flex",
                "flex-direction": "column",
                gap: "0.5rem",
                "margin-top": "0.6rem",
              }}
            >
              <label>
                <span class="label">audio encode args (audio_only stations)</span>
                <textarea
                  rows={3}
                  value={encodeArgs()}
                  onInput={(e) => setEncodeArgs(e.currentTarget.value)}
                />
              </label>
              <label>
                <span class="label">video encode args (audio_or_video/video_only stations)</span>
                <textarea
                  rows={3}
                  value={videoEncodeArgs()}
                  onInput={(e) => setVideoEncodeArgs(e.currentTarget.value)}
                />
              </label>
              <label>
                <span class="label">video codec (MSE SourceBuffer mime type)</span>
                <input
                  type="text"
                  value={videoCodec()}
                  onInput={(e) => setVideoCodec(e.currentTarget.value)}
                />
              </label>
              <div>
                <button type="submit" class="primary small" disabled={savingEncode()}>
                  {savingEncode() ? "saving..." : "save"}
                </button>
              </div>
            </form>
          </details>
        </div>
      </Show>
    </div>
  );
}
