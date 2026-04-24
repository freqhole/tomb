import { createEffect, createSignal, For, Show } from "solid-js";
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
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
