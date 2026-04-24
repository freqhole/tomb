import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { useAdminTransport } from "../admin/context";

interface RadioStation {
  id: string;
  name: string;
  description: string | null;
  is_public: number; // sqlite bool
  is_enabled: number;
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
  mode: string;
  created_at: number;
}

interface StationSong {
  id: string;
  station_id: string;
  song_id: string;
  sort_order: number;
  created_at: number;
}

const FILTER_TYPES = ["tag", "genre", "artist", "album"];
const FILTER_MODES = ["include", "exclude"];

export default function RadioView() {
  const admin = useAdminTransport();
  const [stations, setStations] = createSignal<RadioStation[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [savingId, setSavingId] = createSignal<string | null>(null);

  // create form
  const [showCreate, setShowCreate] = createSignal(false);
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [isPublic, setIsPublic] = createSignal(false);
  const [isEnabled, setIsEnabled] = createSignal(true);
  const [playMode, setPlayMode] = createSignal("shuffle");
  const [creating, setCreating] = createSignal(false);

  // per-station seed editor
  const [expandedId, setExpandedId] = createSignal<string | null>(null);

  // reload whenever the active admin target changes
  createEffect(() => {
    admin.current();
    void loadStations();
  });

  async function loadStations() {
    setLoading(true);
    setError("");
    try {
      const result = await admin.dispatchOrThrow<RadioStation[]>(
        "radio_stations_list",
        undefined,
      );
      setStations(result ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
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
      });
      // reset form
      setName("");
      setDescription("");
      setIsPublic(false);
      setIsEnabled(true);
      setPlayMode("shuffle");
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

      <RadioConfigSection dispatch={admin.dispatchOrThrow} />

      {/* stations section */}
      <div class="section">
        <div class="section-header">
          <h2>
            station<span class="pinky">z</span>
          </h2>
          <button
            class="btn-primary"
            onClick={() => setShowCreate((v) => !v)}
            disabled={creating()}
          >
            {showCreate() ? "cancel" : "+ new station"}
          </button>
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
                <span>public (visible to peers via discovery)</span>
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
                  <option value="sequential">sequential</option>
                </select>
              </label>
            </div>
            <div class="form-row">
              <button type="submit" class="btn-primary" disabled={creating()}>
                {creating() ? "creating..." : "create station"}
              </button>
            </div>
          </form>
        </Show>

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
                <div class="list-item">
                  <div class="item-info">
                    <div class="item-name">
                      <strong>{s.name}</strong>
                      <span
                        class="badge"
                        style={{
                          "margin-left": "0.5rem",
                          background: s.is_public ? "#1f6f43" : "#3a3a3a",
                          color: s.is_public ? "#a7e8c5" : "#aaa",
                        }}
                      >
                        {s.is_public ? "public" : "private"}
                      </span>
                      <span
                        class="badge"
                        style={{
                          "margin-left": "0.25rem",
                          background: s.is_enabled ? "#1f4f6f" : "#6f1f1f",
                          color: s.is_enabled ? "#a7d4e8" : "#e8a7a7",
                        }}
                      >
                        {s.is_enabled ? "on" : "off"}
                      </span>
                    </div>
                    <Show when={s.description}>
                      <div class="item-meta">{s.description}</div>
                    </Show>
                    <div class="item-meta">
                      codec: {s.codec} · play mode: {s.play_mode}
                    </div>
                  </div>
                  <div class="item-actions">
                    <button
                      onClick={() =>
                        setExpandedId((cur) => (cur === s.id ? null : s.id))
                      }
                    >
                      {expandedId() === s.id ? "close seed" : "edit seed"}
                    </button>
                    <button
                      onClick={() => togglePublic(s)}
                      disabled={savingId() === s.id}
                    >
                      {s.is_public ? "make private" : "make public"}
                    </button>
                    <button
                      onClick={() => toggleEnabled(s)}
                      disabled={savingId() === s.id}
                    >
                      {s.is_enabled ? "disable" : "enable"}
                    </button>
                    <button
                      class="btn-danger"
                      onClick={() => deleteStation(s)}
                      disabled={savingId() === s.id}
                    >
                      delete
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
  const [songs, setSongs] = createSignal<StationSong[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  // add-filter form
  const [fType, setFType] = createSignal("tag");
  const [fValue, setFValue] = createSignal("");
  const [fMode, setFMode] = createSignal("include");

  // add-song form
  const [songId, setSongId] = createSignal("");

  createEffect(() => {
    // re-run when stationId changes
    void props.stationId;
    void load();
  });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [fs, ss] = await Promise.all([
        props.dispatch<StationFilter[]>("radio_filters_list", {
          station_id: props.stationId,
        }),
        props.dispatch<StationSong[]>("radio_songs_list", {
          station_id: props.stationId,
        }),
      ]);
      setFilters(fs ?? []);
      setSongs(ss ?? []);
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

  async function addSong(e: Event) {
    e.preventDefault();
    if (!songId().trim()) {
      setError("song id required");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await props.dispatch("radio_songs_add", {
        station_id: props.stationId,
        song_id: songId().trim(),
      });
      setSongId("");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeSong(sid: string) {
    setBusy(true);
    setError("");
    try {
      await props.dispatch("radio_songs_remove", {
        station_id: props.stationId,
        song_id: sid,
      });
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
      style={{ "margin-bottom": "1rem", "border-left": "3px solid #6f5fbd" }}
    >
      <h3 style={{ "margin-top": 0 }}>seed query</h3>
      <p class="item-meta" style={{ "margin-bottom": "1rem" }}>
        explicit songs are always played; filters narrow (include) or remove
        (exclude) candidates from your library.
      </p>

      <Show when={error()}>
        <p class="error">{error()}</p>
      </Show>

      <Show when={loading()}>
        <p>loading seed...</p>
      </Show>

      <Show when={!loading()}>
        {/* filters */}
        <h4>filters</h4>
        <Show when={filters().length === 0}>
          <p class="item-meta">no filters yet</p>
        </Show>
        <For each={filters()}>
          {(f) => (
            <div
              class="list-item"
              style={{ padding: "0.5rem 0.75rem", margin: "0.25rem 0" }}
            >
              <div class="item-info">
                <span
                  class="badge"
                  style={{
                    background: f.mode === "include" ? "#1f6f43" : "#6f1f1f",
                    color: f.mode === "include" ? "#a7e8c5" : "#e8a7a7",
                    "margin-right": "0.5rem",
                  }}
                >
                  {f.mode}
                </span>
                <code>{f.filter_type}</code> = <code>{f.filter_value}</code>
              </div>
              <div class="item-actions">
                <button
                  class="btn-danger"
                  onClick={() => removeFilter(f.id)}
                  disabled={busy()}
                >
                  remove
                </button>
              </div>
            </div>
          )}
        </For>
        <form
          onSubmit={addFilter}
          style={{
            display: "flex",
            gap: "0.5rem",
            "margin-top": "0.5rem",
            "flex-wrap": "wrap",
            "align-items": "flex-end",
          }}
        >
          <select
            value={fMode()}
            onChange={(e) => setFMode(e.currentTarget.value)}
          >
            <For each={FILTER_MODES}>
              {(m) => <option value={m}>{m}</option>}
            </For>
          </select>
          <select
            value={fType()}
            onChange={(e) => setFType(e.currentTarget.value)}
          >
            <For each={FILTER_TYPES}>
              {(t) => <option value={t}>{t}</option>}
            </For>
          </select>
          <SeedSuggestInput
            kind={fType() as "tag" | "genre" | "artist" | "album"}
            value={fValue()}
            onChange={setFValue}
            dispatch={props.dispatch}
            placeholder={`${fType()} name`}
          />
          <button type="submit" class="btn-primary" disabled={busy()}>
            + add filter
          </button>
        </form>

        {/* explicit songs */}
        <h4 style={{ "margin-top": "1.5rem" }}>explicit songs</h4>
        <Show when={songs().length === 0}>
          <p class="item-meta">no explicit songs yet</p>
        </Show>
        <For each={songs()}>
          {(s) => (
            <div
              class="list-item"
              style={{ padding: "0.5rem 0.75rem", margin: "0.25rem 0" }}
            >
              <div class="item-info">
                <code>{s.song_id}</code>
              </div>
              <div class="item-actions">
                <button
                  class="btn-danger"
                  onClick={() => removeSong(s.song_id)}
                  disabled={busy()}
                >
                  remove
                </button>
              </div>
            </div>
          )}
        </For>
        <form
          onSubmit={addSong}
          style={{
            display: "flex",
            gap: "0.5rem",
            "margin-top": "0.5rem",
          }}
        >
          <SongSuggestInput
            value={songId()}
            onChange={setSongId}
            dispatch={props.dispatch}
          />
          <button type="submit" class="btn-primary" disabled={busy()}>
            + add song
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
  kind: "tag" | "genre" | "artist" | "album";
  value: string;
  onChange: (v: string) => void;
  dispatch: Dispatch;
  placeholder?: string;
}

function SeedSuggestInput(props: SeedSuggestInputProps) {
  const listId = `seed-suggest-${Math.random().toString(36).slice(2, 9)}`;
  const [items, setItems] = createSignal<RadioSeedSuggestion[]>([]);
  let timer: number | null = null;

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

  onCleanup(() => {
    if (timer !== null) window.clearTimeout(timer);
  });

  return (
    <>
      <input
        type="text"
        list={listId}
        value={props.value}
        placeholder={props.placeholder ?? "value"}
        autocomplete="off"
        style={{ flex: "1", "min-width": "10rem" }}
        onInput={(e) => {
          props.onChange(e.currentTarget.value);
          fetchSuggestions(e.currentTarget.value);
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
}

function RadioConfigSection(props: { dispatch: Dispatch }) {
  const [enabled, setEnabled] = createSignal(false);
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
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  createEffect(() => {
    void load();
  });

  async function save(e: Event) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await props.dispatch<RadioConfigPayload>("radio_config_set", {
        enabled: enabled(),
        encode_args: encodeArgs(),
      });
      await load();
    } catch (e) {
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
        <form class="card" onSubmit={save}>
          <div class="form-row">
            <label
              style={{
                display: "flex",
                "align-items": "center",
                gap: "0.5rem",
              }}
            >
              <input
                type="checkbox"
                checked={enabled()}
                onChange={(e) => setEnabled(e.currentTarget.checked)}
                disabled={busy()}
              />
              <span class="label">enabled (master switch)</span>
            </label>
          </div>
          <div class="form-row">
            <label>
              <span class="label">
                ffmpeg encode args (use <code>{"{input}"}</code> for the song
                path)
              </span>
              <textarea
                value={encodeArgs()}
                onInput={(e) => setEncodeArgs(e.currentTarget.value)}
                disabled={busy()}
                spellcheck={false}
                style={{
                  width: "100%",
                  "min-height": "6rem",
                  "font-family": "monospace",
                  "font-size": "0.8rem",
                }}
              />
            </label>
          </div>
          <div class="form-row">
            <button type="submit" class="btn-primary" disabled={busy()}>
              {busy() ? "saving..." : "save"}
            </button>
            <span class="item-meta" style={{ "margin-left": "1rem" }}>
              changes apply on next broadcaster start
            </span>
          </div>
        </form>
      </Show>
    </div>
  );
}
