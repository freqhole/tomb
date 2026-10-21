import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type {
  AdminClient,
  LibrarySource,
  RemovableVolume,
  SourceAvailability,
  SourceDomain,
  SourceFolder,
  SourceSelection,
  SessionJobCounts,
} from "@freqhole/api-client";

function required<T>(data: T | null | undefined): T {
  if (data == null) throw new Error("library command returned no data");
  return data;
}

export function LibraryStorageSection(props: { client: AdminClient }) {
  const [expanded, setExpanded] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [volumes, setVolumes] = createSignal<RemovableVolume[]>([]);
  const [sources, setSources] = createSignal<LibrarySource[]>([]);
  const [states, setStates] = createSignal<SourceAvailability[]>([]);
  const [selection, setSelection] = createSignal<SourceSelection>();
  const [folders, setFolders] = createSignal<SourceFolder[]>([]);
  const [domain, setDomain] = createSignal<SourceDomain>("both");
  const [progress, setProgress] = createSignal<SessionJobCounts>();
  const [session, setSession] = createSignal<string>();
  const [checkingProgress, setCheckingProgress] = createSignal(false);
  let progressTimer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;
  function stopProgress() {
    clearTimeout(progressTimer);
    progressTimer = undefined;
    setSession(undefined);
    setProgress(undefined);
    setCheckingProgress(false);
  }
  onCleanup(() => {
    revision++;
    stopProgress();
  });

  async function pollProgress(client: AdminClient, id: string, request: number) {
    setCheckingProgress(true);
    try {
      const counts = required(
        await client.dispatchOrThrow("library_scan_status", { session_id: id })
      );
      if (request !== revision) return;
      setProgress(counts);
      if (counts.pending || counts.running) {
        progressTimer = setTimeout(() => void pollProgress(client, id, request), 2000);
      } else {
        setSession(undefined);
      }
    } catch (e) {
      if (request === revision) setError(`could not read scan progress: ${e}`);
    } finally {
      if (request === revision) setCheckingProgress(false);
    }
  }
  const locked = () => busy() || !!session();

  async function refresh(client: AdminClient) {
    const request = ++revision;
    setBusy(true);
    setError("");
    setSelection(undefined);
    setFolders([]);
    try {
      const [disks, roots, availability] = await Promise.all([
        client.dispatchOrThrow("library_list_removable_volumes", undefined),
        client.dispatchOrThrow("library_list_sources", undefined),
        client.dispatchOrThrow("library_source_availability", undefined),
      ]);
      if (request !== revision) return;
      setVolumes(required(disks));
      setSources(required(roots));
      setStates(required(availability));
    } catch (e) {
      if (request === revision) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === revision) setBusy(false);
    }
  }

  createEffect(() => {
    const client = props.client;
    revision++;
    stopProgress();
    setBusy(false);
    setError("");
    setVolumes([]);
    setSources([]);
    setStates([]);
    setMessage("");
    if (expanded()) void refresh(client);
  });

  async function browse(next: SourceSelection) {
    const client = props.client;
    const request = ++revision;
    stopProgress();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const children = required(await client.dispatchOrThrow("library_browse_volume", next));
      if (request !== revision) return;
      setSelection(next);
      setFolders(children);
    } catch (e) {
      if (request === revision) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === revision) setBusy(false);
    }
  }

  async function scan(source?: LibrarySource) {
    const client = props.client;
    const current = selection();
    if (!source && !current) return;
    const request = ++revision;
    stopProgress();
    setBusy(true);
    setError("");
    setMessage("");
    let registered = false;
    try {
      const root =
        source ??
        required(
          await client.dispatchOrThrow("library_register_source", {
            ...required(current),
            domain: domain(),
          })
        );
      if (request !== revision) return;
      if (!source) {
        registered = true;
        setSources((existing) => [...existing.filter((s) => s.id !== root.id), root]);
        setMessage("folder registered; starting scan...");
      }
      const result = required(await client.dispatchOrThrow("library_scan_source", { id: root.id }));
      if (request !== revision) return;
      if (!result.success) throw new Error(result.message);
      setMessage(result.message);
      setSelection(undefined);
      setFolders([]);
      setSession(result.session_id);
      void pollProgress(client, result.session_id, request);
    } catch (e) {
      if (request === revision) {
        setMessage(
          registered
            ? "folder registered; scan request failed. check the host before retrying."
            : ""
        );
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (request === revision) setBusy(false);
    }
  }

  const buttonClass =
    "px-3 py-1.5 text-sm rounded border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-elevated)] disabled:opacity-50";
  return (
    <section class="rounded-lg border border-[var(--color-border-subtle)] p-4 space-y-3">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-lg font-semibold">library storage</h2>
        <button
          class={buttonClass}
          aria-expanded={expanded()}
          disabled={locked()}
          onClick={() => (expanded() ? void refresh(props.client) : setExpanded(true))}
        >
          {expanded() ? "refresh disks" : "browse disks"}
        </button>
      </div>
      <p class="text-sm text-[var(--color-text-muted)]">
        browse disks on this library host, not this browser. media stays on the disk; removable sync
        destinations are excluded.
      </p>
      <Show when={error()}>
        <p role="alert" class="text-sm text-red-400">
          {error()}
        </p>
      </Show>
      <Show when={message()}>
        <p role="status" class="text-sm">
          {message()}
        </p>
      </Show>
      <Show when={progress()}>
        {(counts) => (
          <p role="status" class="text-sm">
            {counts().completed} / {counts().total} completed · {counts().pending} pending ·{" "}
            {counts().running} running · {counts().failed} failed
            {!session() ? " · scan finished" : ""}
          </p>
        )}
      </Show>
      <Show when={session() && error()}>
        <button
          class={buttonClass}
          disabled={checkingProgress()}
          onClick={() => {
            setError("");
            void pollProgress(props.client, required(session()), revision);
          }}
        >
          retry progress
        </button>
      </Show>
      <Show when={busy()}>
        <p role="status" class="text-sm">
          working...
        </p>
      </Show>
      <Show when={expanded()}>
        <div class="space-y-2">
          <For each={sources()}>
            {(source) => (
              <div class="flex items-center justify-between gap-3 text-sm">
                <div class="min-w-0">
                  <p class="break-all">{source.last_known_path}</p>
                  <p class="text-[var(--color-text-muted)]">
                    {source.domain} ·{" "}
                    {states().find((s) => s.source_id === source.id)?.status ?? "unknown"}
                  </p>
                </div>
                <button class={buttonClass} disabled={locked()} onClick={() => void scan(source)}>
                  scan again
                </button>
              </div>
            )}
          </For>
        </div>
        <Show when={!selection()}>
          <For each={volumes()}>
            {(volume) => (
              <div class="space-y-1 text-sm">
                <p>
                  {volume.label || volume.device_path} · {volume.filesystem}
                </p>
                <Show when={volume.mount_points.length === 0}>
                  <p class="text-[var(--color-text-muted)]">
                    not mounted - mount through the host OS first
                  </p>
                </Show>
                <Show when={!volume.uuid && !volume.partition_uuid}>
                  <p class="text-[var(--color-text-muted)]">
                    no stable disk identity; automatic tracking is unavailable
                  </p>
                </Show>
                <For each={volume.mount_points}>
                  {(mount) => (
                    <button
                      class={buttonClass}
                      disabled={locked() || (!volume.uuid && !volume.partition_uuid)}
                      onClick={() =>
                        void browse({
                          device_path: volume.device_path,
                          mount_path: mount,
                          relative_path: "",
                          domain: domain(),
                        })
                      }
                    >
                      browse {mount}
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
          <Show when={!busy() && !error() && volumes().length === 0}>
            <p class="text-sm text-[var(--color-text-muted)]">no removable library disks found</p>
          </Show>
        </Show>
        <Show when={selection()}>
          {(current) => (
            <div class="space-y-3">
              <p class="text-sm break-all">
                {current().mount_path} / {current().relative_path || "(whole disk)"}
              </p>
              <div class="flex flex-wrap gap-2">
                <button
                  class={buttonClass}
                  disabled={locked()}
                  onClick={() => {
                    setSelection(undefined);
                    setFolders([]);
                  }}
                >
                  disks
                </button>
                <Show when={current().relative_path}>
                  <button
                    class={buttonClass}
                    disabled={locked()}
                    onClick={() =>
                      void browse({
                        ...current(),
                        relative_path: current().relative_path.split("/").slice(0, -1).join("/"),
                      })
                    }
                  >
                    parent folder
                  </button>
                </Show>
                <label class="text-sm flex items-center gap-2">
                  media type
                  <select
                    class={buttonClass}
                    disabled={locked()}
                    value={domain()}
                    onChange={(e) => {
                      const value = e.currentTarget.value;
                      if (value === "both" || value === "music" || value === "video")
                        setDomain(value);
                    }}
                  >
                    <option value="both">music and video</option>
                    <option value="music">music</option>
                    <option value="video">video</option>
                  </select>
                </label>
                <button class={buttonClass} disabled={locked()} onClick={() => void scan()}>
                  {current().relative_path ? "add and scan this folder" : "add and scan whole disk"}
                </button>
              </div>
              <div class="max-h-64 overflow-auto space-y-1">
                <For each={folders()}>
                  {(folder) => (
                    <button
                      class={`${buttonClass} block w-full text-left`}
                      disabled={locked()}
                      onClick={() =>
                        void browse({
                          ...current(),
                          relative_path: folder.relative_path,
                        })
                      }
                    >
                      {folder.name}
                    </button>
                  )}
                </For>
                <Show when={folders().length === 0}>
                  <p class="text-sm text-[var(--color-text-muted)]">no subfolders</p>
                </Show>
              </div>
            </div>
          )}
        </Show>
      </Show>
    </section>
  );
}
