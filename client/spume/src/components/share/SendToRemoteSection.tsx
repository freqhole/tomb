// "send to remote" section of the share modal.
//
// shows a list of eligible destinations and drives a `sendToRemote` (or
// `sendToLocalLibrary`) orchestrator run against the chosen one. the
// list always includes a "local library" entry — in tauri/charnel mode
// that's the charnel-managed remote already returned from the eligible
// list, in plain-browser mode it's a synthetic entry that runs the local
// idb+opfs sync path.
//
// destinations render with the destination remote's image as an "end
// cap" on the left of the row (matching the feed view's remote toggle
// strip).

import { createMemo, createResource, createSignal, For, Show, type Component } from "solid-js";
import { toast } from "../feedback/Toast";
import { Icon, IconNames } from "../icons/registry";
import {
  createEligibleRemotes,
  type EligibleRemote,
} from "../../music/services/send/eligibleRemotes";
import {
  sendToRemote,
  type SendPayload,
  type SendProgress,
} from "../../music/services/send/sendToRemote";
import { sendToLocalLibrary } from "../../music/services/send/sendToLocalLibrary";
import { resolveBlobUrl } from "../../music/services/storage/blobResolver";
import { isCharnelMode } from "../../app/services/charnel";
import { isP2PRemote, type Remote } from "../../app/services/storage/schemas/remote";

export interface SendToRemoteSectionProps {
  /** the source remote — the data being sent originates from here. */
  source: Remote;
  /** lazily build the payload to send (album, playlist, or song). */
  buildPayload: () => SendPayload;
}

// magic id for the synthetic browser-local destination. used only in
// plain-browser mode where there is no charnel-managed remote.
const LOCAL_BROWSER_ID = "__local_browser__";

interface DestEntry {
  id: string;
  name: string;
  /** true when this is the local destination (charnel-managed or browser). */
  isLocal: boolean;
  /** present for "real" remote destinations. */
  remote?: EligibleRemote;
}

export const SendToRemoteSection: Component<SendToRemoteSectionProps> = (props) => {
  const eligible = createEligibleRemotes({
    sourceRemoteId: () => props.source.remote_id,
  });

  // build the rendered destination list. always include a local entry —
  // in charnel mode the charnel-managed remote already comes through the
  // eligible list (we just flag it as local); in browser mode we prepend
  // a synthetic entry that drives the local sync orchestrator.
  const destinations = createMemo<DestEntry[]>(() => {
    const out: DestEntry[] = [];
    const charnelMode = isCharnelMode();
    let localFromEligible: EligibleRemote | undefined;
    for (const e of eligible()) {
      if (e.remote.is_charnel_managed) {
        localFromEligible = e;
        continue;
      }
      out.push({
        id: e.remote.remote_id,
        name: e.remote.name ?? e.remote.remote_id,
        isLocal: false,
        remote: e,
      });
    }
    // local always first
    if (localFromEligible) {
      out.unshift({
        id: localFromEligible.remote.remote_id,
        name: localFromEligible.remote.name ?? "local library",
        isLocal: true,
        remote: localFromEligible,
      });
    } else if (!charnelMode && props.source.remote_id !== LOCAL_BROWSER_ID) {
      // plain browser: synthesize a local destination.
      out.unshift({
        id: LOCAL_BROWSER_ID,
        name: "local library",
        isLocal: true,
      });
    }
    return out;
  });

  const [activeDestId, setActiveDestId] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal<SendProgress | null>(null);
  // last completed run, keyed by dest id — drives the results view.
  const [lastResult, setLastResult] = createSignal<{
    destId: string;
    destName: string;
    progress: SendProgress;
  } | null>(null);

  const runForDest = async (entry: DestEntry, retryBlake3s?: string[]) => {
    setActiveDestId(entry.id);
    setLastResult(null);
    setProgress({
      phase: "preparing",
      totalSongs: 0,
      syncedSongs: 0,
      skippedSongs: 0,
      failedSongs: 0,
      errors: [],
      syncedBlake3s: [],
      failedBlake3s: [],
    });
    const destName = entry.name;
    try {
      const payload = props.buildPayload();
      let final: SendProgress;
      if (entry.isLocal && entry.id === LOCAL_BROWSER_ID) {
        // browser local: skip the iroh-blobs orchestrator entirely.
        final = await sendToLocalLibrary(payload, props.source, {
          onProgress: (p) => setProgress(p),
          retryBlake3s,
        });
      } else {
        // charnel-managed or p2p remote: use the iroh-blobs orchestrator.
        final = await sendToRemote(payload, props.source, entry.remote!.remote, {
          onProgress: (p) => setProgress(p),
          retryBlake3s,
        });
      }
      const summary =
        `sent to ${destName}: ` +
        `${final.syncedSongs} synced, ${final.skippedSongs} skipped, ` +
        `${final.failedSongs} failed`;
      if (final.failedSongs > 0) toast.warning(summary);
      else toast.success(summary);
      setLastResult({ destId: entry.id, destName, progress: final });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`send to ${destName} failed: ${msg}`);
      const snapshot = progress();
      if (snapshot) {
        setLastResult({ destId: entry.id, destName, progress: snapshot });
      }
    } finally {
      setActiveDestId(null);
      setProgress(null);
    }
  };

  const handleSend = (entry: DestEntry) => void runForDest(entry);

  const handleRetryFailed = () => {
    const last = lastResult();
    if (!last) return;
    const failed = last.progress.failedBlake3s;
    if (failed.length === 0) return;
    const entry = destinations().find((e) => e.id === last.destId);
    if (!entry) return;
    void runForDest(entry, failed);
  };

  return (
    <Show when={destinations().length > 0}>
      <section class="space-y-3">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">send to remote</h3>
          <Show when={lastResult() && !activeDestId()}>
            <button
              type="button"
              class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              onClick={() => setLastResult(null)}
            >
              start over
            </button>
          </Show>
        </div>

        {/* RESULTS VIEW: rendered after a run completes (success or failure). */}
        <Show when={lastResult() && !activeDestId()}>
          {(() => {
            const r = lastResult()!;
            const p = r.progress;
            const ok = p.failedSongs === 0 && p.phase !== "failed";
            return (
              <div class="space-y-2 text-sm border border-[var(--color-border-default)] rounded-md p-3">
                <div class="text-[var(--color-text-primary)]">
                  <span class="font-medium">{r.destName}</span>
                </div>
                <div class="text-xs text-[var(--color-text-secondary)] space-y-0.5">
                  <div>
                    <span class="text-[var(--color-text-tertiary)]">synced:</span> {p.syncedSongs}/
                    {p.totalSongs}
                  </div>
                  <Show when={p.skippedSongs > 0}>
                    <div>
                      <span class="text-[var(--color-text-tertiary)]">skipped:</span>{" "}
                      {p.skippedSongs}
                    </div>
                  </Show>
                  <Show when={p.failedSongs > 0}>
                    <div class="text-[var(--color-error,_inherit)]">
                      <span class="text-[var(--color-text-tertiary)]">failed:</span> {p.failedSongs}
                    </div>
                  </Show>
                </div>
                <Show when={p.errors.length > 0}>
                  <details class="text-xs text-[var(--color-text-tertiary)]">
                    <summary class="cursor-pointer hover:text-[var(--color-text-secondary)]">
                      details ({p.errors.length})
                    </summary>
                    <ul class="mt-1 space-y-0.5 max-h-32 overflow-y-auto pl-3 list-disc">
                      <For each={p.errors.slice(0, 20)}>
                        {(err) => <li class="break-words">{err}</li>}
                      </For>
                    </ul>
                  </details>
                </Show>
                <div class="flex items-center gap-2 pt-1">
                  <Show when={p.failedSongs > 0}>
                    <button
                      type="button"
                      onClick={handleRetryFailed}
                      class="px-3 py-1 text-xs rounded-md bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] transition-colors"
                    >
                      retry failed ({p.failedSongs})
                    </button>
                  </Show>
                  <Show when={ok}>
                    <span class="text-xs text-[var(--color-success,_inherit)]">done</span>
                  </Show>
                </div>
              </div>
            );
          })()}
        </Show>

        {/* LIST VIEW: default + during an active run. */}
        <Show when={!lastResult() || activeDestId()}>
          <ul class="space-y-1">
            <For each={destinations()}>
              {(entry) => {
                const isActive = () => activeDestId() === entry.id;
                const p = () => progress();
                const pct = () => {
                  const prog = p();
                  if (!prog || prog.totalSongs === 0) return 0;
                  const done = prog.syncedSongs + prog.skippedSongs + prog.failedSongs;
                  return Math.min(100, Math.round((done / prog.totalSongs) * 100));
                };

                // resolve image url for the end-cap. p2p remotes go via
                // resolveBlobUrl; http remotes use absolute or
                // base_url-prefixed image_url. local synthetic entries
                // have no image (we render the home icon instead).
                const imageUrl = createImageUrl(entry);
                const [imgError, setImgError] = createSignal(false);
                const showImg = () => !!imageUrl() && !imgError();

                return (
                  <li>
                    <button
                      type="button"
                      disabled={!!activeDestId()}
                      onClick={() => handleSend(entry)}
                      class="w-full flex flex-col text-sm text-left rounded-md hover:bg-[var(--color-bg-tertiary)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed border border-[var(--color-border-default)] overflow-hidden"
                    >
                      <div class="flex items-stretch gap-3 min-h-[48px]">
                        {/* end cap: image (when available) or icon tile */}
                        <Show
                          when={showImg()}
                          fallback={
                            <div class="w-12 shrink-0 flex items-center justify-center bg-[var(--color-bg-elevated)] rounded-l-md">
                              <Icon
                                name={entry.isLocal ? IconNames.home : IconNames.recent}
                                size={18}
                                color="var(--color-text-tertiary)"
                              />
                            </div>
                          }
                        >
                          <img
                            src={imageUrl()!}
                            alt=""
                            class="w-12 h-auto shrink-0 object-cover rounded-l-md"
                            onError={() => setImgError(true)}
                          />
                        </Show>
                        <div class="flex-1 min-w-0 flex items-center justify-between gap-3 pr-3 py-2">
                          <div class="min-w-0 flex items-center gap-2">
                            <Show when={entry.isLocal && showImg()}>
                              <Icon
                                name={IconNames.home}
                                className="text-[var(--color-text-tertiary)] shrink-0"
                                size={14}
                              />
                            </Show>
                            <div class="min-w-0">
                              <div class="truncate text-[var(--color-text-primary)]">
                                {entry.name}
                              </div>
                              <div class="truncate text-xs text-[var(--color-text-tertiary)]">
                                {entry.remote ? entry.remote.role : "this device"}
                              </div>
                            </div>
                          </div>
                          <Show when={isActive() && p()}>
                            <span class="text-xs text-[var(--color-text-secondary)] whitespace-nowrap">
                              {p()!.phase} {p()!.syncedSongs}/{p()!.totalSongs}
                            </span>
                          </Show>
                        </div>
                      </div>
                      <Show when={isActive() && p() && p()!.totalSongs > 0}>
                        <div class="h-1 w-full bg-[var(--color-bg-tertiary)] overflow-hidden">
                          <div
                            class="h-full bg-[var(--color-accent,_currentColor)] transition-[width] duration-150"
                            style={{ width: `${pct()}%` }}
                          />
                        </div>
                      </Show>
                    </button>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </section>
    </Show>
  );
};

// resolve a destination's brand image url. handles p2p (blob_id +
// resolveBlobUrl), http (image_url, possibly base_url-prefixed), and the
// synthetic local case (no image). returns an accessor.
function createImageUrl(entry: DestEntry): () => string | null {
  const remote = entry.remote?.remote;
  if (!remote) return () => null;

  const isP2P = isP2PRemote(remote);

  // for p2p remotes with an image_blob_id, resolve via the blob resolver.
  const [resolvedBlobUrl] = createResource(
    () =>
      isP2P && remote.image_blob_id
        ? { blobId: remote.image_blob_id, remoteId: remote.remote_id }
        : null,
    async (params) => {
      if (!params) return null;
      try {
        return await resolveBlobUrl(params.blobId, params.remoteId);
      } catch {
        return null;
      }
    }
  );

  return () => {
    if (isP2P) return resolvedBlobUrl() ?? null;
    if (!remote.image_url) return null;
    if (
      remote.image_url.startsWith("http://") ||
      remote.image_url.startsWith("https://") ||
      remote.image_url.startsWith("asset://")
    ) {
      return remote.image_url;
    }
    if (remote.base_url) return `${remote.base_url}${remote.image_url}`;
    return null;
  };
}
