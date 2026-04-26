// per-remote radio admin view.
//
// dispatches via `freqhole-admin/1` ALPN through the spume `AdminClient`
// factory — same auth + transport story as `RemoteAdminView`. lives at
// `/settings/remotes/:remoteId/radio` so a charnel user can manage radio
// stations on any P2P remote where they hold the admin role (not just
// the local tauri-managed node).
//
// sections:
//   - stations list (toggle public/enabled, edit, delete)
//   - create station form
//
// only reachable when the caller's role on the remote is "admin"; the
// view double-checks via `whoamiForRemote` and renders a "not admin"
// state if the role changed.

import {
  createSignal,
  createResource,
  createEffect,
  onCleanup,
  onMount,
  Show,
  For,
} from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { getRemoteById } from "../../app/services/remotes/remoteManager";
import { whoamiForRemote } from "../../app/services/remotes/authService";
import { adminClientFor } from "../../app/api/adminClient";
import { isP2PRemote, type Remote } from "../../app/services/storage/schemas/remote";
import {
  AdminClient,
  AdminCommandError,
  type RadioStation,
  type CreateStationRequest,
  type UpdateStationRequest,
  type StationFilter,
  type StationSong,
  type RadioSeedSuggestion,
  type RadioConfigPayload,
} from "freqhole-api-client";
import { toast } from "../../components/feedback/Toast";

export function RadioAdminView() {
  const params = useParams<{ remoteId: string }>();
  const navigate = useNavigate();

  const [remote, setRemote] = createSignal<Remote | null>(null);
  const [adminClient, setAdminClient] = createSignal<AdminClient | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const r = await getRemoteById(params.remoteId);
      if (!r) {
        setError(`remote ${params.remoteId} not found`);
        setLoading(false);
        return;
      }
      if (!isP2PRemote(r)) {
        setError("radio admin is only available for P2P remotes");
        setLoading(false);
        return;
      }
      setRemote(r);

      const me = await whoamiForRemote(r);
      if (!me.success || me.role !== "admin") {
        setError(`you are not an admin on this remote (role: ${me.role ?? "unknown"})`);
        setLoading(false);
        return;
      }

      const client = await adminClientFor(r);
      setAdminClient(client);
    } catch (e) {
      setError(`failed to initialize radio admin: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  });

  return (
    <div class="p-6 max-w-5xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <div>
          <button
            class="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors mb-2"
            onClick={() => navigate(`/settings/remotes/${params.remoteId}/admin`)}
          >
            back to admin
          </button>
          <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">
            radio: {remote()?.name ?? params.remoteId}
          </h1>
          <p class="text-sm text-[var(--color-text-muted)]">
            create, configure, and remove radio stations on this remote
          </p>
        </div>
      </div>

      <Show when={loading()}>
        <div class="text-[var(--color-text-muted)]">loading admin client...</div>
      </Show>

      <Show when={!loading() && error()}>
        <div class="rounded-lg border border-red-600/30 bg-red-600/10 p-4 text-red-400">
          {error()}
        </div>
      </Show>

      <Show when={!loading() && !error() && adminClient()}>
        <div class="flex flex-col gap-8">
          <RadioConfigSection client={adminClient()!} />
          <StationsSection client={adminClient()!} />
          <CreateStationSection client={adminClient()!} />
        </div>
      </Show>
    </div>
  );
}

// ------------------------------------------------------------------
// node-wide [radio] config
// ------------------------------------------------------------------

function RadioConfigSection(props: { client: AdminClient }) {
  const [cfg, { refetch }] = createResource<RadioConfigPayload | null>(async () => {
    try {
      const data = await props.client.dispatchOrThrow("radio_config_get", undefined);
      return (data ?? null) as RadioConfigPayload | null;
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to load radio config: ${msg}`);
      return null;
    }
  });

  const [enabled, setEnabled] = createSignal(false);
  const [encodeArgs, setEncodeArgs] = createSignal("");
  const [ffmpegAvailable, setFfmpegAvailable] = createSignal(true);
  const [busy, setBusy] = createSignal(false);

  // hydrate the form whenever the resource resolves with fresh data.
  createEffect(() => {
    const c = cfg();
    if (c) {
      setEnabled(c.enabled);
      setEncodeArgs(c.encode_args);
      setFfmpegAvailable(c.ffmpeg_available);
    }
  });

  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      await props.client.dispatchOrThrow("radio_config_set", {
        enabled: enabled(),
        encode_args: encodeArgs(),
        ffmpeg_available: ffmpegAvailable(),
      });
      toast.success("radio config saved");
      await refetch();
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to save radio config: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] p-4">
      <h2 class="text-lg font-semibold text-[var(--color-text-primary)] mb-1">radio config</h2>
      <p class="text-xs text-[var(--color-text-muted)] mb-4">
        node-wide <code>[radio]</code> section in the toml. changes are written atomically and the
        broadcaster picks them up on next start. flipping
        <code class="mx-1">enabled</code> to false will not stop a running broadcaster — restart the
        server to apply.
      </p>
      <Show
        when={!cfg.loading}
        fallback={<div class="text-xs text-[var(--color-text-muted)]">loading config...</div>}
      >
        <form class="flex flex-col gap-3" onSubmit={save}>
          <label class="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
            <input
              type="checkbox"
              checked={enabled()}
              onChange={(e) => setEnabled(e.currentTarget.checked)}
              disabled={busy()}
            />
            <span>enabled</span>
          </label>
          <label class="flex flex-col gap-1">
            <span class="text-xs text-[var(--color-text-secondary)]">
              ffmpeg encode args (use <code>{"{input}"}</code> for the song path)
            </span>
            <textarea
              class="font-mono text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] min-h-[6rem]"
              value={encodeArgs()}
              onInput={(e) => setEncodeArgs(e.currentTarget.value)}
              disabled={busy()}
              spellcheck={false}
            />
          </label>
          <div>
            <button
              type="submit"
              class="px-3 py-1 text-sm rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-600/30 disabled:opacity-50"
              disabled={busy()}
            >
              {busy() ? "saving..." : "save"}
            </button>
          </div>
        </form>
      </Show>
    </section>
  );
}

// ------------------------------------------------------------------
// stations list
// ------------------------------------------------------------------

function StationsSection(props: { client: AdminClient }) {
  const [stations, { refetch }] = createResource<RadioStation[]>(async () => {
    try {
      const data = await props.client.dispatchOrThrow("radio_stations_list", undefined);
      return (data ?? []) as RadioStation[];
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to load stations: ${msg}`);
      return [];
    }
  });

  const [savingId, setSavingId] = createSignal<string | null>(null);
  const [expandedId, setExpandedId] = createSignal<string | null>(null);

  const togglePublic = async (s: RadioStation) => {
    setSavingId(s.id);
    try {
      const req: UpdateStationRequest = { id: s.id, is_public: !s.is_public };
      await props.client.dispatchOrThrow("radio_stations_update", req);
      toast.success(`station ${!s.is_public ? "is now public" : "is now private"}`);
      await refetch();
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to update: ${msg}`);
    } finally {
      setSavingId(null);
    }
  };

  const toggleEnabled = async (s: RadioStation) => {
    setSavingId(s.id);
    try {
      const req: UpdateStationRequest = { id: s.id, is_enabled: !s.is_enabled };
      await props.client.dispatchOrThrow("radio_stations_update", req);
      toast.success(`station ${!s.is_enabled ? "enabled" : "disabled"}`);
      await refetch();
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to update: ${msg}`);
    } finally {
      setSavingId(null);
    }
  };

  const toggleTimelineOnly = async (s: RadioStation) => {
    setSavingId(s.id);
    const next = s.timeline_only_mode === 0;
    try {
      const req: UpdateStationRequest = { id: s.id, timeline_only_mode: next };
      await props.client.dispatchOrThrow("radio_stations_update", req);
      toast.success(`timeline-only mode ${next ? "enabled" : "disabled"}`);
      await refetch();
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to update: ${msg}`);
    } finally {
      setSavingId(null);
    }
  };

  const deleteStation = async (s: RadioStation) => {
    if (!window.confirm(`delete station "${s.name}"? this cannot be undone.`)) return;
    setSavingId(s.id);
    try {
      await props.client.dispatchOrThrow("radio_stations_delete", { id: s.id });
      toast.success(`station "${s.name}" deleted`);
      await refetch();
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to delete: ${msg}`);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold text-[var(--color-text-primary)]">stations</h2>
        <button
          class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors disabled:opacity-50"
          onClick={() => refetch()}
          disabled={stations.loading}
        >
          {stations.loading ? "loading..." : "refresh"}
        </button>
      </div>

      <Show
        when={!stations.loading && (stations()?.length ?? 0) > 0}
        fallback={
          <div class="text-sm text-[var(--color-text-muted)]">
            {stations.loading ? "loading stations..." : "no stations configured yet"}
          </div>
        }
      >
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                <th class="py-2 pr-4">name</th>
                <th class="py-2 pr-4">public</th>
                <th class="py-2 pr-4">enabled</th>
                <th class="py-2 pr-4">codec</th>
                <th class="py-2 pr-4">play mode</th>
                <th class="py-2 pr-4">timeline only</th>
                <th class="py-2 pr-4 text-right">actions</th>
              </tr>
            </thead>
            <tbody>
              <For each={stations() ?? []}>
                {(s) => (
                  <>
                    <tr class="border-t border-[var(--color-border-subtle)]">
                      <td class="py-2 pr-4">
                        <div class="font-medium text-[var(--color-text-primary)]">{s.name}</div>
                        <Show when={s.description}>
                          <div class="text-xs text-[var(--color-text-muted)]">{s.description}</div>
                        </Show>
                      </td>
                      <td class="py-2 pr-4">
                        <span
                          class={
                            s.is_public
                              ? "px-2 py-0.5 text-xs rounded-full bg-emerald-600/20 text-emerald-400"
                              : "px-2 py-0.5 text-xs rounded-full bg-neutral-700/40 text-neutral-400"
                          }
                        >
                          {s.is_public ? "public" : "private"}
                        </span>
                      </td>
                      <td class="py-2 pr-4">
                        <span
                          class={
                            s.is_enabled
                              ? "px-2 py-0.5 text-xs rounded-full bg-emerald-600/20 text-emerald-400"
                              : "px-2 py-0.5 text-xs rounded-full bg-red-600/20 text-red-400"
                          }
                        >
                          {s.is_enabled ? "on" : "off"}
                        </span>
                      </td>
                      <td class="py-2 pr-4 text-xs text-[var(--color-text-muted)]">{s.codec}</td>
                      <td class="py-2 pr-4 text-xs text-[var(--color-text-muted)]">
                        {s.play_mode}
                      </td>
                      <td class="py-2 pr-4">
                        <span
                          class={
                            s.timeline_only_mode
                              ? "px-2 py-0.5 text-xs rounded-full bg-violet-600/20 text-violet-400"
                              : "px-2 py-0.5 text-xs rounded-full bg-neutral-700/40 text-neutral-400"
                          }
                          title={
                            s.timeline_only_mode
                              ? "chunk streaming disabled — listeners use queue mode"
                              : "chunk streaming enabled"
                          }
                        >
                          {s.timeline_only_mode ? "on" : "off"}
                        </span>
                      </td>
                      <td class="py-2 pr-4">
                        <div class="flex items-center justify-end gap-2">
                          <button
                            class="px-2 py-1 text-xs rounded bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)]"
                            onClick={() => setExpandedId((cur) => (cur === s.id ? null : s.id))}
                          >
                            {expandedId() === s.id ? "close seed" : "edit seed"}
                          </button>
                          <button
                            class="px-2 py-1 text-xs rounded bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] disabled:opacity-50"
                            onClick={() => togglePublic(s)}
                            disabled={savingId() === s.id}
                          >
                            {s.is_public ? "make private" : "make public"}
                          </button>
                          <button
                            class="px-2 py-1 text-xs rounded bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] disabled:opacity-50"
                            onClick={() => toggleEnabled(s)}
                            disabled={savingId() === s.id}
                          >
                            {s.is_enabled ? "disable" : "enable"}
                          </button>
                          <button
                            class={
                              s.timeline_only_mode
                                ? "px-2 py-1 text-xs rounded bg-violet-600/20 hover:bg-violet-600/30 text-violet-400 border border-violet-600/30 disabled:opacity-50"
                                : "px-2 py-1 text-xs rounded bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] disabled:opacity-50"
                            }
                            onClick={() => toggleTimelineOnly(s)}
                            disabled={savingId() === s.id}
                            title={
                              s.timeline_only_mode
                                ? "disable timeline-only mode (re-enable chunk streaming)"
                                : "force timeline-only mode for all listeners"
                            }
                          >
                            {s.timeline_only_mode ? "disable tl-only" : "force tl-only"}
                          </button>
                          <button
                            class="px-2 py-1 text-xs rounded bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 disabled:opacity-50"
                            onClick={() => deleteStation(s)}
                            disabled={savingId() === s.id}
                          >
                            delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    <Show when={expandedId() === s.id}>
                      <tr class="border-t border-[var(--color-border-subtle)]">
                        <td colspan={7} class="py-3 pr-4">
                          <StationSeedEditor stationId={s.id} client={props.client} />
                        </td>
                      </tr>
                    </Show>
                  </>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </section>
  );
}

// ------------------------------------------------------------------
// create station form
// ------------------------------------------------------------------

function CreateStationSection(props: { client: AdminClient }) {
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [isPublic, setIsPublic] = createSignal(false);
  const [isEnabled, setIsEnabled] = createSignal(true);
  const [playMode, setPlayMode] = createSignal("shuffle");
  const [submitting, setSubmitting] = createSignal(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!name().trim()) {
      toast.error("station name is required");
      return;
    }
    setSubmitting(true);
    try {
      const req: CreateStationRequest = {
        name: name().trim(),
        description: description().trim() || undefined,
        is_public: isPublic(),
        is_enabled: isEnabled(),
        play_mode: playMode(),
      };
      const created = (await props.client.dispatchOrThrow(
        "radio_stations_create",
        req
      )) as RadioStation;
      toast.success(`station "${created.name}" created`);
      // reset form
      setName("");
      setDescription("");
      setIsPublic(false);
      setIsEnabled(true);
      setPlayMode("shuffle");
      // poke the page so the stations list refreshes — simplest is reload
      // the route. (a shared resource would be cleaner; deferred.)
      window.location.reload();
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to create station: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] p-5">
      <h2 class="text-lg font-semibold text-[var(--color-text-primary)] mb-3">
        create new station
      </h2>
      <p class="text-sm text-[var(--color-text-muted)] mb-4">
        seed song selection (filters / explicit songs) can be configured after creation. for now,
        new stations start empty.
      </p>
      <form class="grid gap-4" onSubmit={submit}>
        <label class="flex flex-col gap-1">
          <span class="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">name</span>
          <input
            class="w-full rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-sm text-[var(--color-text-primary)] border border-[var(--color-border-subtle)]"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            placeholder="late night jams"
            required
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            description (optional)
          </span>
          <input
            class="w-full rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-sm text-[var(--color-text-primary)] border border-[var(--color-border-subtle)]"
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
            placeholder="ambient + downtempo"
          />
        </label>
        <div class="flex flex-wrap items-center gap-6">
          <label class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={isPublic()}
              onChange={(e) => setIsPublic(e.currentTarget.checked)}
            />
            public (visible to peers via discovery)
          </label>
          <label class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={isEnabled()}
              onChange={(e) => setIsEnabled(e.currentTarget.checked)}
            />
            enabled
          </label>
          <label class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            play mode
            <select
              class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1 text-sm text-[var(--color-text-primary)] border border-[var(--color-border-subtle)]"
              value={playMode()}
              onChange={(e) => setPlayMode(e.currentTarget.value)}
            >
              <option value="shuffle">shuffle</option>
              <option value="sequential">sequential</option>
            </select>
          </label>
        </div>
        <div>
          <button
            type="submit"
            class="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white transition-colors disabled:opacity-50"
            disabled={submitting()}
          >
            {submitting() ? "creating..." : "create station"}
          </button>
        </div>
      </form>
    </section>
  );
}

// ------------------------------------------------------------------
// per-station seed editor (filters + explicit songs)
// ------------------------------------------------------------------

const FILTER_TYPES = ["tag", "genre", "artist", "album"];
const FILTER_MODES = ["include", "exclude"];

function StationSeedEditor(props: { stationId: string; client: AdminClient }) {
  const [filters, { refetch: refetchFilters }] = createResource<StationFilter[]>(async () => {
    try {
      const data = await props.client.dispatchOrThrow("radio_filters_list", {
        station_id: props.stationId,
      });
      return (data ?? []) as StationFilter[];
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to load filters: ${msg}`);
      return [];
    }
  });

  const [songs, { refetch: refetchSongs }] = createResource<StationSong[]>(async () => {
    try {
      const data = await props.client.dispatchOrThrow("radio_songs_list", {
        station_id: props.stationId,
      });
      return (data ?? []) as StationSong[];
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to load songs: ${msg}`);
      return [];
    }
  });

  const [busy, setBusy] = createSignal(false);
  const [fType, setFType] = createSignal("tag");
  const [fValue, setFValue] = createSignal("");
  const [fMode, setFMode] = createSignal("include");
  const [songId, setSongId] = createSignal("");

  const addFilter = async (e: Event) => {
    e.preventDefault();
    if (!fValue().trim()) {
      toast.error("filter value required");
      return;
    }
    setBusy(true);
    try {
      await props.client.dispatchOrThrow("radio_filters_add", {
        station_id: props.stationId,
        filter_type: fType(),
        filter_value: fValue().trim(),
        mode: fMode(),
      });
      setFValue("");
      await refetchFilters();
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to add filter: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const removeFilter = async (filterId: string) => {
    setBusy(true);
    try {
      await props.client.dispatchOrThrow("radio_filters_remove", { filter_id: filterId });
      await refetchFilters();
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to remove filter: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const addSong = async (e: Event) => {
    e.preventDefault();
    if (!songId().trim()) {
      toast.error("song id required");
      return;
    }
    setBusy(true);
    try {
      await props.client.dispatchOrThrow("radio_songs_add", {
        station_id: props.stationId,
        song_id: songId().trim(),
      });
      setSongId("");
      await refetchSongs();
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to add song: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const removeSong = async (sid: string) => {
    setBusy(true);
    try {
      await props.client.dispatchOrThrow("radio_songs_remove", {
        station_id: props.stationId,
        song_id: sid,
      });
      await refetchSongs();
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to remove song: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-4">
      <div class="text-xs text-[var(--color-text-muted)] mb-3">
        seed query — explicit songs are always played; filters narrow (include) or remove (exclude)
        candidates from your library.
      </div>

      {/* filters */}
      <div class="mb-4">
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)] mb-2">filters</h3>
        <Show
          when={!filters.loading && (filters()?.length ?? 0) > 0}
          fallback={
            <div class="text-xs text-[var(--color-text-muted)] mb-2">
              {filters.loading ? "loading..." : "no filters yet"}
            </div>
          }
        >
          <ul class="flex flex-col gap-1 mb-2">
            <For each={filters() ?? []}>
              {(f) => (
                <li class="flex items-center justify-between gap-2 text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)]">
                  <span>
                    <span
                      class={
                        f.mode === "include"
                          ? "px-1.5 py-0.5 rounded bg-emerald-600/20 text-emerald-400 mr-2"
                          : "px-1.5 py-0.5 rounded bg-red-600/20 text-red-400 mr-2"
                      }
                    >
                      {f.mode}
                    </span>
                    <code class="text-[var(--color-text-secondary)]">{f.filter_type}</code>
                    <span class="text-[var(--color-text-muted)]"> = </span>
                    <code class="text-[var(--color-text-primary)]">{f.filter_value}</code>
                  </span>
                  <button
                    class="px-2 py-0.5 text-xs rounded bg-red-600/20 hover:bg-red-600/30 text-red-400 disabled:opacity-50"
                    onClick={() => removeFilter(f.id)}
                    disabled={busy()}
                  >
                    remove
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <form class="flex flex-wrap items-end gap-2" onSubmit={addFilter}>
          <select
            class="text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
            value={fMode()}
            onChange={(e) => setFMode(e.currentTarget.value)}
          >
            <For each={FILTER_MODES}>{(m) => <option value={m}>{m}</option>}</For>
          </select>
          <select
            class="text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
            value={fType()}
            onChange={(e) => setFType(e.currentTarget.value)}
          >
            <For each={FILTER_TYPES}>{(t) => <option value={t}>{t}</option>}</For>
          </select>
          <SeedSuggestInput
            client={props.client}
            kind={fType() as "tag" | "genre" | "artist" | "album"}
            value={fValue()}
            onChange={setFValue}
            placeholder={`${fType()} name`}
          />
          <button
            type="submit"
            class="px-3 py-1 text-xs rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-600/30 disabled:opacity-50"
            disabled={busy()}
          >
            + add filter
          </button>
        </form>
      </div>

      {/* explicit songs */}
      <div>
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)] mb-2">explicit songs</h3>
        <Show
          when={!songs.loading && (songs()?.length ?? 0) > 0}
          fallback={
            <div class="text-xs text-[var(--color-text-muted)] mb-2">
              {songs.loading ? "loading..." : "no explicit songs yet"}
            </div>
          }
        >
          <ul class="flex flex-col gap-1 mb-2">
            <For each={songs() ?? []}>
              {(s) => (
                <li class="flex items-center justify-between gap-2 text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)]">
                  <code class="text-[var(--color-text-primary)]">{s.song_id}</code>
                  <button
                    class="px-2 py-0.5 text-xs rounded bg-red-600/20 hover:bg-red-600/30 text-red-400 disabled:opacity-50"
                    onClick={() => removeSong(s.song_id)}
                    disabled={busy()}
                  >
                    remove
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <form class="flex items-end gap-2" onSubmit={addSong}>
          <SongSuggestInput client={props.client} value={songId()} onChange={setSongId} />
          <button
            type="submit"
            class="px-3 py-1 text-xs rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-600/30 disabled:opacity-50"
            disabled={busy()}
          >
            + add song
          </button>
        </form>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// seed value autocomplete helpers
// ------------------------------------------------------------------
//
// both inputs query `radio_seed_suggest` over the active admin transport
// (debounced ~200ms) so suggestions come from the same library the
// station is being configured against — not the local spume cache. uses
// the native <datalist> for keyboard nav + accessibility; for songs we
// keep a label↔id map so the user picks by title but we still submit
// the uuid that `radio_songs_add` requires.

interface SeedSuggestInputProps {
  client: AdminClient;
  kind: "tag" | "genre" | "artist" | "album";
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
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
        const data = await props.client.dispatchOrThrow("radio_seed_suggest", {
          kind: props.kind,
          query: q.trim(),
          limit: 15,
        });
        setItems((data ?? []) as RadioSeedSuggestion[]);
      } catch {
        // silent: autocomplete is opportunistic, manual entry still works.
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
        class="flex-1 min-w-[10rem] text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
        type="text"
        list={listId}
        placeholder={props.placeholder ?? "value"}
        value={props.value}
        disabled={props.disabled}
        autocomplete="off"
        onInput={(e) => {
          const v = e.currentTarget.value;
          props.onChange(v);
          fetchSuggestions(v);
        }}
        onFocus={(e) => fetchSuggestions(e.currentTarget.value)}
      />
      <datalist id={listId}>
        <For each={items()}>
          {(it) => <option value={it.name}>{it.subtitle ? `${it.subtitle}` : ""}</option>}
        </For>
      </datalist>
    </>
  );
}

interface SongSuggestInputProps {
  client: AdminClient;
  value: string;
  onChange: (songId: string) => void;
  disabled?: boolean;
}

function SongSuggestInput(props: SongSuggestInputProps) {
  const listId = `song-suggest-${Math.random().toString(36).slice(2, 9)}`;
  const [items, setItems] = createSignal<RadioSeedSuggestion[]>([]);
  // local input shows the human label; props.value tracks the resolved id.
  const [text, setText] = createSignal("");
  let timer: number | null = null;

  // when caller resets value (e.g. after submit), clear the visible text too.
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
        const data = await props.client.dispatchOrThrow("radio_seed_suggest", {
          kind: "song",
          query: q.trim(),
          limit: 15,
        });
        setItems((data ?? []) as RadioSeedSuggestion[]);
      } catch {
        setItems([]);
      }
    }, 200);
  };

  // resolve typed text → id: prefer exact label match in current items, else
  // pass through (allowing pasted uuids).
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
        class="flex-1 text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
        type="text"
        list={listId}
        placeholder="song title or uuid"
        value={text()}
        disabled={props.disabled}
        autocomplete="off"
        onInput={(e) => {
          const v = e.currentTarget.value;
          setText(v);
          fetchSuggestions(v);
          resolve(v);
        }}
        onFocus={(e) => fetchSuggestions(e.currentTarget.value)}
      />
      <datalist id={listId}>
        <For each={items()}>{(it) => <option value={it.name}>{it.subtitle ?? ""}</option>}</For>
      </datalist>
    </>
  );
}
