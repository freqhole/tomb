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

import { createSignal, createResource, createEffect, onMount, Show, For } from "solid-js";
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
  type RadioConfigPayload,
  type RadioBumper,
} from "@freqhole/api-client";
import { toast } from "../../components/feedback/Toast";
import { SeedSuggestInput, SongSuggestInput } from "../../components/radio/SeedSuggestInputs";
import {
  REFERENCE_FILTER_TYPES,
  CRITERIA_FILTER_TYPES,
  VIDEO_REFERENCE_FILTER_TYPES,
  VIDEO_ONLY_FILTER_TYPES,
  type RadioFilterType,
  isRadioReferenceFilterType,
  isNoValueFilterType,
  isRatingFilterType,
  filterDisplayValue,
  FILTER_MODES,
} from "../../components/radio/filterTypes";

export function RadioAdminView() {
  const params = useParams<{ remoteId: string }>();
  const navigate = useNavigate();

  const [remote, setRemote] = createSignal<Remote | null>(null);
  const [adminClient, setAdminClient] = createSignal<AdminClient | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [radioEnabled, setRadioEnabled] = createSignal(true);
  const [ffmpegAvailable, setFfmpegAvailable] = createSignal(true);
  const [stationsRefreshTick, setStationsRefreshTick] = createSignal(0);

  const refreshStations = () => setStationsRefreshTick((n) => n + 1);

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
            create and manage radio stations on this remote
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
          <RadioConfigSection
            client={adminClient()!}
            onStateChange={(next) => {
              setRadioEnabled(next.enabled);
              setFfmpegAvailable(next.ffmpegAvailable);
            }}
          />
          <Show
            when={radioEnabled()}
            fallback={
              <section class="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] p-4">
                <p class="text-sm text-[var(--color-text-muted)]">
                  radio is disabled. enable it above to manage stations.
                </p>
              </section>
            }
          >
            <StationsSection
              client={adminClient()!}
              refreshKey={stationsRefreshTick}
              ffmpegAvailable={ffmpegAvailable}
            />
            <CreateStationSection
              client={adminClient()!}
              ffmpegAvailable={ffmpegAvailable}
              onCreated={refreshStations}
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ------------------------------------------------------------------
// node-wide [radio] config
// ------------------------------------------------------------------

function RadioConfigSection(props: {
  client: AdminClient;
  onStateChange?: (next: { enabled: boolean; ffmpegAvailable: boolean }) => void;
}) {
  const [cfg, { refetch }] = createResource<RadioConfigPayload>(async () => {
    const data = await props.client.dispatchOrThrow("radio_config_get", undefined);
    return data as RadioConfigPayload;
  });

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
  const [ffmpegAvailable, setFfmpegAvailable] = createSignal(true);
  const [busy, setBusy] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string | null>(null);

  // `undefined` unless the field differs from what was last loaded (and
  // isn't blank) - see the field-tracking comment above.
  function dirtyOrUndefined(current: string, loaded: string): string | undefined {
    const trimmed = current.trim();
    return trimmed !== "" && trimmed !== loaded ? trimmed : undefined;
  }

  // hydrate the form whenever the resource resolves with fresh data.
  createEffect(() => {
    if (cfg.loading) return;

    const err = cfg.error;
    if (err) {
      const msg =
        err instanceof AdminCommandError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setLoadError(`failed to load radio config: ${msg}`);
      return;
    }

    const c = cfg();
    if (c) {
      const ffmpeg = c.ffmpeg_available !== false;
      setEnabled(c.enabled);
      setEncodeArgs(c.encode_args ?? "");
      setVideoEncodeArgs(c.video_encode_args ?? "");
      setVideoCodec(c.video_codec ?? "");
      setLoadedEncodeArgs(c.encode_args ?? "");
      setLoadedVideoEncodeArgs(c.video_encode_args ?? "");
      setLoadedVideoCodec(c.video_codec ?? "");
      setMaxConcurrentAudioStreams(c.max_concurrent_audio_streams ?? 2);
      setMaxConcurrentVideoStreams(c.max_concurrent_video_streams ?? 1);
      setFfmpegAvailable(ffmpeg);
      setLoadError(null);
      props.onStateChange?.({ enabled: c.enabled, ffmpegAvailable: ffmpeg });
    }
  });

  const save = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      await props.client.dispatchOrThrow("radio_config_set", {
        enabled: enabled(),
        encode_args: dirtyOrUndefined(encodeArgs(), loadedEncodeArgs()),
        video_encode_args: dirtyOrUndefined(videoEncodeArgs(), loadedVideoEncodeArgs()),
        video_codec: dirtyOrUndefined(videoCodec(), loadedVideoCodec()),
        ffmpeg_available: ffmpegAvailable(),
        max_concurrent_audio_streams: maxConcurrentAudioStreams(),
        max_concurrent_video_streams: maxConcurrentVideoStreams(),
      });
      props.onStateChange?.({ enabled: enabled(), ffmpegAvailable: ffmpegAvailable() });
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
        broadcaster applies them immediately. toggling
        <code class="mx-1">enabled</code> starts/stops running broadcasters on this node.
      </p>
      <Show when={loadError()}>
        <div class="mb-3 rounded border border-red-600/30 bg-red-600/10 p-2 text-xs text-red-400">
          {loadError()}
        </div>
      </Show>
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
          <div class="flex gap-3">
            <label class="flex flex-col gap-1 flex-1">
              <span class="text-xs text-[var(--color-text-secondary)]">
                max concurrent audio streams (audio_only stations)
              </span>
              <input
                type="number"
                min="0"
                class="text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                value={maxConcurrentAudioStreams()}
                onInput={(e) => setMaxConcurrentAudioStreams(e.currentTarget.valueAsNumber || 0)}
                disabled={busy()}
              />
            </label>
            <label class="flex flex-col gap-1 flex-1">
              <span class="text-xs text-[var(--color-text-secondary)]">
                max concurrent video streams (audio_or_video/video_only stations)
              </span>
              <input
                type="number"
                min="0"
                class="text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                value={maxConcurrentVideoStreams()}
                onInput={(e) => setMaxConcurrentVideoStreams(e.currentTarget.valueAsNumber || 0)}
                disabled={busy()}
              />
            </label>
          </div>
          <details class="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)]/40 p-3">
            <summary class="text-xs font-medium text-[var(--color-text-secondary)] cursor-pointer select-none">
              advanced: node-wide ffmpeg defaults
            </summary>
            <div class="flex flex-col gap-3 mt-3">
              <label class="flex flex-col gap-1">
                <span class="text-xs text-[var(--color-text-secondary)]">
                  ffmpeg encode args (use <code>{"{input}"}</code> for the song path) - used by
                  audio-only stations with no per-station override
                </span>
                <textarea
                  class="font-mono text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] min-h-[6rem]"
                  value={encodeArgs()}
                  onInput={(e) => setEncodeArgs(e.currentTarget.value)}
                  disabled={busy()}
                  spellcheck={false}
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-xs text-[var(--color-text-secondary)]">
                  video-capable ffmpeg encode args - used by audio_or_video/video_only stations with
                  no per-station override (keeps the video stream, unlike the args above)
                </span>
                <textarea
                  class="font-mono text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] min-h-[6rem]"
                  value={videoEncodeArgs()}
                  onInput={(e) => setVideoEncodeArgs(e.currentTarget.value)}
                  disabled={busy()}
                  spellcheck={false}
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-xs text-[var(--color-text-secondary)]">
                  video codec (MSE SourceBuffer mime type matching the args above)
                </span>
                <input
                  class="font-mono text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                  value={videoCodec()}
                  onInput={(e) => setVideoCodec(e.currentTarget.value)}
                  disabled={busy()}
                  spellcheck={false}
                />
              </label>
            </div>
          </details>
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

function StationsSection(props: {
  client: AdminClient;
  refreshKey: () => number;
  ffmpegAvailable: () => boolean;
}) {
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [stations, { refetch }] = createResource<RadioStation[], number>(
    props.refreshKey,
    async () => {
      try {
        const data = await props.client.dispatchOrThrow("radio_stations_list", undefined);
        setLoadError(null);
        return (data ?? []) as RadioStation[];
      } catch (e) {
        const msg =
          e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
        setLoadError(`failed to load stations: ${msg}`);
        return [];
      }
    }
  );

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
    if (!props.ffmpegAvailable() && !next) {
      toast.error(
        "ffmpeg is not installed on this node, so this station must run in timeline-only mode"
      );
      setSavingId(null);
      return;
    }
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
      <Show when={loadError()}>
        <div class="mb-3 rounded border border-red-600/30 bg-red-600/10 p-2 text-xs text-red-400">
          {loadError()}
        </div>
      </Show>

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
                <th class="py-2 pr-4">content</th>
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
                      <td class="py-2 pr-4">
                        <span
                          class={
                            s.content_mode === "video_only"
                              ? "px-2 py-0.5 text-xs rounded-full bg-fuchsia-600/20 text-fuchsia-400"
                              : s.content_mode === "audio_or_video"
                                ? "px-2 py-0.5 text-xs rounded-full bg-sky-600/20 text-sky-400"
                                : "px-2 py-0.5 text-xs rounded-full bg-neutral-700/40 text-neutral-400"
                          }
                        >
                          {s.content_mode === "video_only"
                            ? "video only"
                            : s.content_mode === "audio_or_video"
                              ? "audio + video"
                              : "audio only"}
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
                            disabled={
                              savingId() === s.id ||
                              (!props.ffmpegAvailable() && s.timeline_only_mode !== 0)
                            }
                            title={
                              !props.ffmpegAvailable() && s.timeline_only_mode !== 0
                                ? "ffmpeg is unavailable on this node"
                                : s.timeline_only_mode
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
                          <div class="flex flex-col gap-3">
                            <StationSeedEditor stationId={s.id} client={props.client} />
                            <StationBumperEditor
                              stationId={s.id}
                              client={props.client}
                              frequencySeconds={s.bumper_frequency_seconds ?? null}
                            />
                            <StationEncodeOverrideEditor
                              stationId={s.id}
                              client={props.client}
                              encodeArgs={s.encode_args ?? ""}
                              codec={s.codec}
                              onSaved={() => {
                                void refetch();
                              }}
                            />
                          </div>
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

function CreateStationSection(props: {
  client: AdminClient;
  ffmpegAvailable: () => boolean;
  onCreated?: () => void;
}) {
  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [isPublic, setIsPublic] = createSignal(false);
  const [isEnabled, setIsEnabled] = createSignal(true);
  const [playMode, setPlayMode] = createSignal("shuffle");
  const [timelineOnly, setTimelineOnly] = createSignal(false);
  const [contentMode, setContentMode] = createSignal<
    "audio_only" | "audio_or_video" | "video_only"
  >("audio_only");
  // advanced, per-station ffmpeg override - left blank by default so the
  // station inherits the node-wide `[radio].encode_args`/`.video_codec`
  // config (see RadioConfigSection) instead of a value baked in here.
  // only sent to the server when the operator actually types something.
  const [encodeArgs, setEncodeArgs] = createSignal("");
  const [codec, setCodec] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);

  createEffect(() => {
    if (!props.ffmpegAvailable()) {
      setTimelineOnly(true);
    }
  });

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
        timeline_only_mode: props.ffmpegAvailable() ? timelineOnly() : true,
        content_mode: contentMode(),
        encode_args: encodeArgs().trim() || undefined,
        codec: codec().trim() || undefined,
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
      setTimelineOnly(!props.ffmpegAvailable());
      setContentMode("audio_only");
      setEncodeArgs("");
      setCodec("");
      props.onCreated?.();
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
              <option value="album">album</option>
            </select>
          </label>
          <label class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            <input
              type="checkbox"
              checked={!timelineOnly()}
              onChange={(e) => setTimelineOnly(!e.currentTarget.checked)}
              disabled={!props.ffmpegAvailable()}
            />
            ffmpeg chunk mode (uncheck for timeline-only mode)
          </label>
          <label class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            content
            <select
              class="rounded bg-[var(--color-bg-tertiary)] px-2 py-1 text-sm text-[var(--color-text-primary)] border border-[var(--color-border-subtle)]"
              value={contentMode()}
              onChange={(e) =>
                setContentMode(
                  e.currentTarget.value as "audio_only" | "audio_or_video" | "video_only"
                )
              }
            >
              <option value="audio_only">audio only</option>
              <option value="audio_or_video">audio + video</option>
              <option value="video_only">video only</option>
            </select>
          </label>
        </div>
        <Show when={!props.ffmpegAvailable()}>
          <div class="text-xs text-[var(--color-text-muted)]">
            ffmpeg is not installed on this node; stations will run in timeline-only mode.
          </div>
        </Show>
        <details class="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)]/40 p-3">
          <summary class="text-xs font-medium text-[var(--color-text-secondary)] cursor-pointer select-none">
            advanced: per-station ffmpeg override
          </summary>
          <div class="flex flex-col gap-3 mt-3">
            <div class="text-xs text-[var(--color-text-muted)]">
              leave blank to use this node's <code>[radio]</code> config defaults (see "radio
              config" above) - a video-capable content mode already gets a video-carrying encode
              from there automatically. only set these if THIS station specifically needs a
              different ffmpeg encode or codec than the node default.
            </div>
            <label class="flex flex-col gap-1">
              <span class="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                codec (MSE SourceBuffer mime type)
              </span>
              <input
                class="w-full rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-xs font-mono text-[var(--color-text-primary)] border border-[var(--color-border-subtle)]"
                value={codec()}
                onInput={(e) => setCodec(e.currentTarget.value)}
                placeholder="(inherit from node config)"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                encode args (ffmpeg, `{"{input}"}` placeholder)
              </span>
              <textarea
                class="w-full rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-xs font-mono text-[var(--color-text-primary)] border border-[var(--color-border-subtle)]"
                rows={3}
                value={encodeArgs()}
                onInput={(e) => setEncodeArgs(e.currentTarget.value)}
                placeholder="(inherit from node config)"
              />
            </label>
          </div>
        </details>
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
//
// filter-type constants/helpers (`FILTER_TYPES`, `isReferenceFilterType`,
// `filterDisplayValue`, ...) live in `components/radio/filterTypes.ts` -
// shared with the removable-storage sync filter-set editor.

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

  const [busy, setBusy] = createSignal(false);
  const [fType, setFType] = createSignal<RadioFilterType>("tag");
  const [fValue, setFValue] = createSignal("");
  const [fMode, setFMode] = createSignal("include");

  const addFilter = async (e: Event) => {
    e.preventDefault();
    if (!isNoValueFilterType(fType()) && !fValue().trim()) {
      toast.error("filter value required");
      return;
    }
    setBusy(true);
    try {
      await props.client.dispatchOrThrow("radio_filters_add", {
        station_id: props.stationId,
        filter_type: fType(),
        filter_value: isNoValueFilterType(fType()) ? "" : fValue().trim(),
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

  return (
    <div class="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-4">
      <div class="text-xs text-[var(--color-text-muted)] mb-3">
        seed query — every clause references a real record. include rows define the candidate set
        (intersection); exclude rows subtract from it. add `track` filters to pin specific songs, or
        `video`/`video_series` for a specific video/series; `all_videos` shuffles across every
        playable video in the library (a good starting point for a video-only station).
      </div>

      {/* filters */}
      <div>
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
                    <span class="text-[var(--color-text-primary)]" title={f.filter_value}>
                      {filterDisplayValue(f)}
                    </span>
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
            onChange={(e) => {
              setFType(e.currentTarget.value as RadioFilterType);
              setFValue("");
            }}
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
                  client={props.client}
                  kind={
                    fType() as
                      "tag" | "taxon" | "artist" | "album" | "playlist" | "video" | "video_series"
                  }
                  value={fValue()}
                  onChange={setFValue}
                  placeholder={`${fType()} name`}
                />
              }
            >
              <SongSuggestInput client={props.client} value={fValue()} onChange={setFValue} />
            </Show>
          </Show>
          <Show when={isNoValueFilterType(fType())}>
            <span class="text-xs text-[var(--color-text-muted)] px-1">no value needed</span>
          </Show>
          <Show when={!isRadioReferenceFilterType(fType()) && !isNoValueFilterType(fType())}>
            <input
              type="number"
              class="text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] w-24"
              min={isRatingFilterType(fType()) ? 1 : 0}
              max={isRatingFilterType(fType()) ? 5 : undefined}
              step={1}
              placeholder={isRatingFilterType(fType()) ? "1-5" : "0"}
              value={fValue()}
              onInput={(e) => setFValue(e.currentTarget.value)}
            />
          </Show>
          <button
            type="submit"
            class="px-3 py-1 text-xs rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-600/30 disabled:opacity-50"
            disabled={busy()}
          >
            + add filter
          </button>
        </form>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// per-station ffmpeg override (codec + encode args) - see
// `RadioStation.encode_args`'s doc comment in grimoire for why the
// override is nullable but "clear" from this form sends an empty
// string (the only way `radio_stations_update`'s COALESCE can revert
// it to the node-wide default).
// ------------------------------------------------------------------

function StationEncodeOverrideEditor(props: {
  stationId: string;
  client: AdminClient;
  encodeArgs: string;
  codec: string;
  onSaved: () => void | Promise<void>;
}) {
  const [encodeArgs, setEncodeArgs] = createSignal(props.encodeArgs);
  const [codec, setCodec] = createSignal(props.codec);
  const [busy, setBusy] = createSignal(false);

  const save = async (e: Event) => {
    e.preventDefault();
    if (!codec().trim()) {
      toast.error("codec is required (station playback breaks without one)");
      return;
    }
    setBusy(true);
    try {
      const req: UpdateStationRequest = {
        id: props.stationId,
        encode_args: encodeArgs().trim(),
        codec: codec().trim(),
      };
      await props.client.dispatchOrThrow("radio_stations_update", req);
      toast.success("per-station ffmpeg override saved");
      await props.onSaved();
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to save ffmpeg override: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)]/40 p-3">
      <div class="text-xs font-medium text-[var(--color-text-secondary)] mb-2">
        per-station ffmpeg override
      </div>
      <p class="text-xs text-[var(--color-text-muted)] mb-3">
        leave "encode args" blank to inherit this node's <code>[radio]</code> config default for
        this station's content mode (see "radio config" above).
      </p>
      <form class="flex flex-col gap-3" onSubmit={save}>
        <label class="flex flex-col gap-1">
          <span class="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            codec (MSE SourceBuffer mime type)
          </span>
          <input
            class="w-full rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-xs font-mono text-[var(--color-text-primary)] border border-[var(--color-border-subtle)]"
            value={codec()}
            onInput={(e) => setCodec(e.currentTarget.value)}
            disabled={busy()}
            spellcheck={false}
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            encode args (ffmpeg, {"{input}"} placeholder)
          </span>
          <textarea
            class="font-mono text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] min-h-[5rem]"
            value={encodeArgs()}
            onInput={(e) => setEncodeArgs(e.currentTarget.value)}
            disabled={busy()}
            placeholder="(inherit from node config)"
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
    </div>
  );
}

// ------------------------------------------------------------------
// per-station bumper editor (DJ drops / station IDs)
// ------------------------------------------------------------------

function StationBumperEditor(props: {
  stationId: string;
  client: AdminClient;
  frequencySeconds: number | null;
}) {
  const [bumpers, { refetch }] = createResource<RadioBumper[]>(async () => {
    try {
      const data = await props.client.dispatchOrThrow("radio_bumpers_list", {
        station_id: props.stationId,
      });
      return (data ?? []) as RadioBumper[];
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to load bumpers: ${msg}`);
      return [];
    }
  });

  const [busy, setBusy] = createSignal(false);
  const [bKind, setBKind] = createSignal<"song" | "video">("song");
  const [bValue, setBValue] = createSignal("");
  const [bLabel, setBLabel] = createSignal("");
  const [bWeight, setBWeight] = createSignal(1);
  const [freq, setFreq] = createSignal(props.frequencySeconds?.toString() ?? "");
  const [freqBusy, setFreqBusy] = createSignal(false);

  const addBumper = async (e: Event) => {
    e.preventDefault();
    if (!bValue().trim()) {
      toast.error(`pick a ${bKind()} for this bumper`);
      return;
    }
    if (!bLabel().trim()) {
      toast.error("bumper label required");
      return;
    }
    setBusy(true);
    try {
      await props.client.dispatchOrThrow("radio_bumpers_add", {
        station_id: props.stationId,
        song_id: bKind() === "song" ? bValue().trim() : null,
        video_id: bKind() === "video" ? bValue().trim() : null,
        label: bLabel().trim(),
        weight: bWeight(),
      });
      setBValue("");
      setBLabel("");
      setBWeight(1);
      await refetch();
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to add bumper: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const removeBumper = async (bumperId: string) => {
    setBusy(true);
    try {
      await props.client.dispatchOrThrow("radio_bumpers_remove", { bumper_id: bumperId });
      await refetch();
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to remove bumper: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const saveFrequency = async (e: Event) => {
    e.preventDefault();
    setFreqBusy(true);
    try {
      const trimmed = freq().trim();
      const frequency_seconds = trimmed === "" ? null : Number(trimmed);
      await props.client.dispatchOrThrow("radio_bumpers_set_frequency", {
        station_id: props.stationId,
        frequency_seconds,
      });
      toast.success("bumper cadence saved");
    } catch (e) {
      const msg =
        e instanceof AdminCommandError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(`failed to save bumper cadence: ${msg}`);
    } finally {
      setFreqBusy(false);
    }
  };

  return (
    <div class="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-base)] p-4">
      <h3 class="text-sm font-semibold text-[var(--color-text-primary)] mb-2">bumpers</h3>
      <div class="text-xs text-[var(--color-text-muted)] mb-3">
        short DJ-drop/station-id clips the broadcaster slots between regular tracks. song and video
        bumpers can both be attached to any station regardless of its content mode.
      </div>

      <form class="flex flex-wrap items-end gap-2 mb-3" onSubmit={saveFrequency}>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-[var(--color-text-secondary)]">
            play a bumper every N seconds (blank = bumpers off)
          </span>
          <input
            type="number"
            min="0"
            class="text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] w-40"
            value={freq()}
            onInput={(e) => setFreq(e.currentTarget.value)}
            disabled={freqBusy()}
          />
        </label>
        <button
          type="submit"
          class="px-3 py-1 text-xs rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-600/30 disabled:opacity-50"
          disabled={freqBusy()}
        >
          save cadence
        </button>
      </form>

      <Show
        when={!bumpers.loading && (bumpers()?.length ?? 0) > 0}
        fallback={
          <div class="text-xs text-[var(--color-text-muted)] mb-2">
            {bumpers.loading ? "loading..." : "no bumpers yet"}
          </div>
        }
      >
        <ul class="flex flex-col gap-1 mb-2">
          <For each={bumpers() ?? []}>
            {(b) => (
              <li class="flex items-center justify-between gap-2 text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)]">
                <span>
                  <span
                    class={
                      b.video_id
                        ? "px-1.5 py-0.5 rounded bg-violet-600/20 text-violet-400 mr-2"
                        : "px-1.5 py-0.5 rounded bg-sky-600/20 text-sky-400 mr-2"
                    }
                  >
                    {b.video_id ? "video" : "song"}
                  </span>
                  <span class="text-[var(--color-text-primary)]">{b.label}</span>
                  <span class="text-[var(--color-text-muted)]"> (weight {b.weight})</span>
                </span>
                <button
                  class="px-2 py-0.5 text-xs rounded bg-red-600/20 hover:bg-red-600/30 text-red-400 disabled:opacity-50"
                  onClick={() => removeBumper(b.id)}
                  disabled={busy()}
                >
                  remove
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <form class="flex flex-wrap items-end gap-2" onSubmit={addBumper}>
        <select
          class="text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
          value={bKind()}
          onChange={(e) => {
            setBKind(e.currentTarget.value as "song" | "video");
            setBValue("");
          }}
        >
          <option value="song">song</option>
          <option value="video">video</option>
        </select>
        <Show
          when={bKind() === "song"}
          fallback={
            <SeedSuggestInput
              client={props.client}
              kind="video"
              value={bValue()}
              onChange={setBValue}
              placeholder="video title"
            />
          }
        >
          <SongSuggestInput client={props.client} value={bValue()} onChange={setBValue} />
        </Show>
        <input
          type="text"
          class="text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
          placeholder="label (e.g. station id)"
          value={bLabel()}
          onInput={(e) => setBLabel(e.currentTarget.value)}
        />
        <input
          type="number"
          min="1"
          class="text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] w-16"
          title="weight (higher = picked more often)"
          value={bWeight()}
          onInput={(e) => setBWeight(e.currentTarget.valueAsNumber || 1)}
        />
        <button
          type="submit"
          class="px-3 py-1 text-xs rounded bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-600/30 disabled:opacity-50"
          disabled={busy()}
        >
          + add bumper
        </button>
      </form>
    </div>
  );
}

// seed value autocomplete inputs (`SeedSuggestInput`/`SongSuggestInput`)
// live in `components/radio/SeedSuggestInputs.tsx` - shared with the
// removable-storage sync filter-set editor.
