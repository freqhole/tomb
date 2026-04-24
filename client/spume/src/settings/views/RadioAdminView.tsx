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

import { createSignal, createResource, onMount, Show, For } from "solid-js";
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
          <StationsSection client={adminClient()!} />
          <CreateStationSection client={adminClient()!} />
        </div>
      </Show>
    </div>
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
                <th class="py-2 pr-4 text-right">actions</th>
              </tr>
            </thead>
            <tbody>
              <For each={stations() ?? []}>
                {(s) => (
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
                    <td class="py-2 pr-4 text-xs text-[var(--color-text-muted)]">{s.play_mode}</td>
                    <td class="py-2 pr-4">
                      <div class="flex items-center justify-end gap-2">
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
                          class="px-2 py-1 text-xs rounded bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30 disabled:opacity-50"
                          onClick={() => deleteStation(s)}
                          disabled={savingId() === s.id}
                        >
                          delete
                        </button>
                      </div>
                    </td>
                  </tr>
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
