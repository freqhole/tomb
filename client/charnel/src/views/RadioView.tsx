import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
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
  created_at: number;
  updated_at: number;
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

const FILTER_TYPES = [
  "tag",
  "genre",
  "artist",
  "album",
  "playlist",
  "track",
] as const;
type FilterType = (typeof FILTER_TYPES)[number];
const FILTER_MODES = ["include", "exclude"];

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
    a.created_at === b.created_at &&
    a.updated_at === b.updated_at
  );
}

function mergeStations(
  previous: RadioStation[],
  next: RadioStation[],
): RadioStation[] {
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
  const [playMode, setPlayMode] = createSignal("shuffle");
  const [timelineOnly, setTimelineOnly] = createSignal(false);
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
        admin.dispatchOrThrow<RadioConfigPayload>(
          "radio_config_get",
          undefined,
        ),
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
        play_mode: playMode(),
        timeline_only_mode: ffmpegAvailable() ? timelineOnly() : true,
      });
      // reset form
      setName("");
      setDescription("");
      setIsPublic(false);
      setIsEnabled(true);
      setPlayMode("shuffle");
      setTimelineOnly(!ffmpegAvailable());
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

      <RadioConfigSection
        dispatch={admin.dispatchOrThrow}
        onEnabledChange={setRadioEnabled}
      />

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
              <div
                class="form-row"
                style={{ display: "flex", gap: "1.5rem", "flex-wrap": "wrap" }}
              >
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
                    onChange={(e) => setIsPublic(e.currentTarget.checked)}
                  />
                  <span>public (visible to anyone who has the link)</span>
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
                  <select
                    value={playMode()}
                    onChange={(e) => setPlayMode(e.currentTarget.value)}
                  >
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
                  <span>
                    ffmpeg chunk mode (uncheck for timeline-only mode)
                  </span>
                </label>
              </div>
              <Show when={!ffmpegAvailable()}>
                <p class="item-meta">
                  ffmpeg is not installed on this node; stations will run in
                  timeline-only mode.
                </p>
              </Show>
              <div class="form-row" style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  type="submit"
                  class="primary small"
                  disabled={creating()}
                >
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
                              <span
                                class="item-meta"
                                style={{ "font-size": "0.8rem" }}
                              >
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
                          onInput={(e) =>
                            setEditDescription(e.currentTarget.value)
                          }
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
                        class={
                          s.is_public ? "primary small" : "secondary small"
                        }
                        onClick={() => togglePublic(s)}
                        disabled={savingId() === s.id}
                        title={s.is_public ? "make private" : "make public"}
                      >
                        {s.is_public ? "public" : "private"}
                      </button>
                      <button
                        class={
                          s.is_enabled ? "primary small" : "secondary small"
                        }
                        onClick={() => toggleEnabled(s)}
                        disabled={savingId() === s.id}
                        title={
                          s.is_enabled ? "disable station" : "enable station"
                        }
                      >
                        {s.is_enabled ? "enabled" : "disabled"}
                      </button>
                      <button
                        class={
                          !s.timeline_only_mode
                            ? "primary small"
                            : "secondary small"
                        }
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
                            await admin.dispatchOrThrow(
                              "radio_stations_update",
                              {
                                id: s.id,
                                play_mode: e.currentTarget.value,
                              },
                            );
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
                        onClick={() =>
                          setExpandedId((cur) => (cur === s.id ? null : s.id))
                        }
                      >
                        {expandedId() === s.id ? "▴ hide seed" : "▾ edit seed"}
                      </button>
                    </div>
                  </div>
                  <Show when={expandedId() === s.id}>
                    <StationSeedEditor
                      stationId={s.id}
                      dispatch={admin.dispatchOrThrow}
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
  const [fType, setFType] = createSignal<FilterType>("tag");
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
    if (!fValue().trim()) {
      setError("filter value required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await props.dispatch("radio_filters_add", {
        station_id: props.stationId,
        filter_type: fType(),
        filter_value: fValue().trim(),
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
                  {f.filter_label && f.filter_label.length > 0
                    ? f.filter_label
                    : f.filter_value}
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
            <p
              class="item-meta"
              style={{ margin: "0.25rem 0", "font-size": "0.78rem" }}
            >
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
            <For each={FILTER_MODES}>
              {(m) => <option value={m}>{m}</option>}
            </For>
          </select>
          <select
            value={fType()}
            onChange={(e) => {
              setFType(e.currentTarget.value as FilterType);
              setFValue("");
            }}
            style={{ "font-size": "0.8rem" }}
          >
            <For each={FILTER_TYPES}>
              {(t) => <option value={t}>{t}</option>}
            </For>
          </select>
          <Show
            when={fType() === "track"}
            fallback={
              <SeedSuggestInput
                kind={
                  fType() as "tag" | "genre" | "artist" | "album" | "playlist"
                }
                value={fValue()}
                onChange={setFValue}
                dispatch={props.dispatch}
                placeholder={`${fType()} name`}
              />
            }
          >
            <SongSuggestInput
              value={fValue()}
              onChange={setFValue}
              dispatch={props.dispatch}
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
  kind: "tag" | "genre" | "artist" | "album" | "playlist";
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
        const data = await props.dispatch<RadioSeedSuggestion[]>(
          "radio_seed_suggest",
          { kind: props.kind, query: q.trim(), limit: 15 },
        );
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
        <For each={items()}>
          {(it) => <option value={it.name}>{it.subtitle ?? ""}</option>}
        </For>
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
        const data = await props.dispatch<RadioSeedSuggestion[]>(
          "radio_seed_suggest",
          { kind: "song", query: q.trim(), limit: 15 },
        );
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
        <For each={items()}>
          {(it) => <option value={it.name}>{it.subtitle ?? ""}</option>}
        </For>
      </datalist>
    </>
  );
}

// ------------------------------------------------------------------
// node-wide [radio] config editor
// ------------------------------------------------------------------

interface RadioConfigPayload {
  enabled: boolean;
  encode_args: string;
  ffmpeg_available?: boolean;
}

interface RadioConfigSectionProps {
  dispatch: Dispatch;
  onEnabledChange?: (enabled: boolean) => void;
}

function RadioConfigSection(props: RadioConfigSectionProps) {
  const [enabled, setEnabled] = createSignal(false);
  // loaded silently — still passed through on toggle so encode_args isn't lost
  const [encodeArgs, setEncodeArgs] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [err, setErr] = createSignal("");

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const cfg = await props.dispatch<RadioConfigPayload>(
        "radio_config_get",
        undefined,
      );
      setEnabled(cfg.enabled);
      setEncodeArgs(cfg.encode_args);
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
  // freqhole-config.toml. encode_args is passed through unchanged.
  async function toggleEnabled(next: boolean) {
    const prev = enabled();
    setEnabled(next);
    setBusy(true);
    setErr("");
    try {
      await props.dispatch<RadioConfigPayload>("radio_config_set", {
        enabled: next,
        encode_args: encodeArgs(),
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
        </div>
      </Show>
    </div>
  );
}
