// "send to remote" section of the share modal.
//
// renders every candidate destination (p2p remotes + charnel-managed
// local + browser-local fallback) immediately. each row shows a status
// badge (checking / offline / needs-login / view-only / ready) and, once
// the payload's blake3 list is known, a per-destination "already has X
// of N" badge from `/api/blobz/has`. the row's send button is disabled
// when the destination isn't ready or already has every blob.
//
// the payload itself is fetched lazily — `buildPayload` may return a
// promise (album/playlist context-menu shares need to fetch the song
// list before sending). while it loads we render a "preparing..."
// indicator inline; nothing blocks the modal's other sections.

import { createMemo, createResource, createSignal, For, Show, type Component } from "solid-js";
import { toast } from "../feedback/Toast";
import { Icon, IconNames } from "../icons/registry";
import {
  createCandidateDestinations,
  type CandidateDestination,
} from "../../music/services/send/destinationCandidates";
import {
  createBlobPresenceProbe,
  createLocalBlobPresenceProbe,
  type ProbeSongHashes,
} from "../../music/services/send/destinationProbe";
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
  /**
   * lazily build the payload. may be sync (album/playlist views with the
   * song list already loaded) or async (context-menu shares that need to
   * fetch songs first). called once when the section mounts.
   */
  buildPayload: () => SendPayload | Promise<SendPayload>;
}

// magic id for the synthetic browser-local destination. used only in
// plain-browser mode where there is no charnel-managed remote.
const LOCAL_BROWSER_ID = "__local_browser__";

interface DestEntry {
  id: string;
  name: string;
  /** true when this is the local destination (charnel-managed or browser). */
  isLocal: boolean;
  /** the underlying candidate. absent for the synthetic browser-local entry. */
  candidate?: CandidateDestination;
}

export const SendToRemoteSection: Component<SendToRemoteSectionProps> = (props) => {
  const candidates = createCandidateDestinations({
    sourceRemoteId: () => props.source.remote_id,
  });

  // resolve the payload eagerly — the modal user can be confident the
  // section is "ready to send" within a tick of opening. resource so
  // solid handles the loading/error transitions for us.
  const [payload] = createResource(async () => {
    return await props.buildPayload();
  });

  // collected blake3s the destinations should be probed against. derived
  // from the resolved payload so probes don't fire until we know what
  // we're sending.
  const probeBlake3s = createMemo<string[] | null>(() => {
    const p = payload();
    if (!p) return null;
    const songs = p.kind === "song" ? [p.song] : p.songs;
    return songs.map((s) => s.blake3).filter((b): b is string => !!b);
  });

  // richer pairs for the local (idb) probe — needs sha256 to do indexed
  // lookups on the local songs store (no blake3 index).
  const probeSongs = createMemo<ProbeSongHashes[] | null>(() => {
    const p = payload();
    if (!p) return null;
    const songs = p.kind === "song" ? [p.song] : p.songs;
    return songs
      .filter((s) => !!s.blake3 && !!s.sha256)
      .map((s) => ({ blake3: s.blake3 as string, sha256: s.sha256 as string }));
  });

  // assemble the rendered destination list. always include a local entry
  // up top — charnel-managed comes through as a regular candidate (we
  // just flag it as local); plain browser mode synthesizes one.
  const destinations = createMemo<DestEntry[]>(() => {
    const out: DestEntry[] = [];
    const charnelMode = isCharnelMode();
    let localFromCandidates: CandidateDestination | undefined;
    for (const c of candidates()) {
      if (c.remote.is_charnel_managed) {
        localFromCandidates = c;
        continue;
      }
      out.push({
        id: c.remote.remote_id,
        name: c.remote.name ?? c.remote.remote_id,
        isLocal: false,
        candidate: c,
      });
    }
    if (localFromCandidates) {
      out.unshift({
        id: localFromCandidates.remote.remote_id,
        name: localFromCandidates.remote.name ?? "local library",
        isLocal: true,
        candidate: localFromCandidates,
      });
    } else if (!charnelMode && props.source.remote_id !== LOCAL_BROWSER_ID) {
      // plain browser — no charnel-managed remote in storage; synthesize
      // a row that drives `sendToLocalLibrary` (idb + opfs).
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
  const [lastResult, setLastResult] = createSignal<{
    destId: string;
    destName: string;
    progress: SendProgress;
  } | null>(null);

  const runForDest = async (entry: DestEntry, retryBlake3s?: string[]) => {
    const p = payload();
    if (!p) {
      toast.error("payload not ready yet");
      return;
    }
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
      let final: SendProgress;
      if (entry.isLocal && entry.id === LOCAL_BROWSER_ID) {
        final = await sendToLocalLibrary(p, props.source, {
          onProgress: (pp) => setProgress(pp),
          retryBlake3s,
        });
      } else {
        final = await sendToRemote(p, props.source, entry.candidate!.remote, {
          onProgress: (pp) => setProgress(pp),
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
      if (snapshot) setLastResult({ destId: entry.id, destName, progress: snapshot });
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

        <Show when={payload.loading}>
          <div class="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
            <Icon name={IconNames.loader} size={14} className="animate-spin" />
            <span>preparing payload...</span>
          </div>
        </Show>
        <Show when={payload.error}>
          <div class="text-xs text-[var(--color-error,_inherit)]">
            failed to prepare payload: {String(payload.error)}
          </div>
        </Show>

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
              {(entry) => (
                <DestinationRow
                  entry={entry}
                  payloadReady={!payload.loading && !payload.error}
                  probeBlake3s={probeBlake3s}
                  probeSongs={probeSongs}
                  isActive={() => activeDestId() === entry.id}
                  anyActive={() => !!activeDestId()}
                  progress={progress}
                  onSend={() => handleSend(entry)}
                />
              )}
            </For>
          </ul>
        </Show>
      </section>
    </Show>
  );
};

interface DestinationRowProps {
  entry: DestEntry;
  payloadReady: boolean;
  probeBlake3s: () => string[] | null;
  probeSongs: () => ProbeSongHashes[] | null;
  isActive: () => boolean;
  anyActive: () => boolean;
  progress: () => SendProgress | null;
  onSend: () => void;
}

const DestinationRow: Component<DestinationRowProps> = (props) => {
  // pick the right probe per row:
  //   - synthetic browser-local entry → idb lookup (no transport)
  //   - everyone else → `/api/blobz/has` over the destination transport
  const isBrowserLocal = () => !props.entry.candidate;
  const remotePresence = createBlobPresenceProbe(
    () => (isBrowserLocal() ? null : (props.entry.candidate?.remote ?? null)),
    () => (isBrowserLocal() ? null : props.probeBlake3s())
  );
  const localPresence = createLocalBlobPresenceProbe(() =>
    isBrowserLocal() ? props.probeSongs() : null
  );
  const presence = () => (isBrowserLocal() ? localPresence() : remotePresence());

  const status = (): CandidateDestination["status"] => {
    const c = props.entry.candidate;
    // synthetic browser-local: always ready.
    if (!c) return { kind: "ready", role: "admin" };
    return c.status;
  };

  const blobsCount = () => props.probeBlake3s()?.length ?? 0;
  const allAlreadyPresent = () => {
    const total = blobsCount();
    if (total === 0) return false;
    const pr = presence();
    return !pr.checking && !pr.error && pr.presentCount >= total;
  };

  const sendDisabled = () =>
    props.anyActive() || !props.payloadReady || status().kind !== "ready" || allAlreadyPresent();

  const imageUrl = createImageUrl(props.entry);
  const [imgError, setImgError] = createSignal(false);
  const showImg = () => !!imageUrl() && !imgError();
  const pct = () => {
    const prog = props.progress();
    if (!prog || prog.totalSongs === 0) return 0;
    const done = prog.syncedSongs + prog.skippedSongs + prog.failedSongs;
    return Math.min(100, Math.round((done / prog.totalSongs) * 100));
  };

  return (
    <li>
      <button
        type="button"
        disabled={sendDisabled()}
        onClick={() => props.onSend()}
        class="w-full flex flex-col text-sm text-left rounded-md hover:bg-[var(--color-bg-tertiary)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed border border-[var(--color-border-default)] overflow-hidden"
      >
        <div class="flex items-stretch gap-3 min-h-[48px]">
          <Show
            when={showImg()}
            fallback={
              <div class="w-12 shrink-0 flex items-center justify-center bg-[var(--color-bg-elevated)] rounded-l-md">
                <Icon
                  name={props.entry.isLocal ? IconNames.home : IconNames.recent}
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
              <Show when={props.entry.isLocal && showImg()}>
                <Icon
                  name={IconNames.home}
                  className="text-[var(--color-text-tertiary)] shrink-0"
                  size={14}
                />
              </Show>
              <div class="min-w-0">
                <div class="truncate text-[var(--color-text-primary)]">{props.entry.name}</div>
                <div class="truncate text-xs text-[var(--color-text-tertiary)] flex items-center gap-2">
                  <StatusBadge status={status()} />
                  <BlobBadge
                    show={blobsCount() > 0 && status().kind === "ready"}
                    presence={presence}
                    total={blobsCount}
                  />
                </div>
              </div>
            </div>
            <Show when={props.isActive() && props.progress()}>
              <span class="text-xs text-[var(--color-text-secondary)] whitespace-nowrap">
                {props.progress()!.phase} {props.progress()!.syncedSongs}/
                {props.progress()!.totalSongs}
              </span>
            </Show>
          </div>
        </div>
        <Show when={props.isActive() && props.progress() && props.progress()!.totalSongs > 0}>
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
};

const StatusBadge: Component<{ status: CandidateDestination["status"] }> = (props) => {
  const s = () => props.status;
  return (
    <Show when={s()}>
      {(st) => {
        const v = st();
        if (v.kind === "checking") {
          return (
            <span class="inline-flex items-center gap-1">
              <Icon name={IconNames.loader} size={11} className="animate-spin" />
              checking
            </span>
          );
        }
        if (v.kind === "ready") return <span>{v.role}</span>;
        if (v.kind === "offline") {
          return (
            <span class="inline-flex items-center gap-1 text-[var(--color-text-tertiary)]">
              <Icon name={IconNames.alertTriangle} size={11} />
              offline
            </span>
          );
        }
        if (v.kind === "needs-login") {
          return (
            <span class="inline-flex items-center gap-1 text-[var(--color-text-tertiary)]">
              <Icon name={IconNames.alertTriangle} size={11} />
              needs login
            </span>
          );
        }
        if (v.kind === "view-only") {
          return (
            <span class="inline-flex items-center gap-1 text-[var(--color-text-tertiary)]">
              <Icon name={IconNames.info} size={11} />
              view-only ({v.role})
            </span>
          );
        }
        return (
          <span class="inline-flex items-center gap-1 text-[var(--color-text-tertiary)]">
            unsupported
          </span>
        );
      }}
    </Show>
  );
};

const BlobBadge: Component<{
  show: boolean;
  presence: () => { checking: boolean; presentCount: number; error?: string };
  total: () => number;
}> = (props) => {
  return (
    <Show when={props.show}>
      <span class="inline-flex items-center gap-1">
        {(() => {
          const pr = props.presence();
          const total = props.total();
          if (pr.checking) {
            return (
              <>
                <Icon name={IconNames.loader} size={11} className="animate-spin" />
                <span>checking music</span>
              </>
            );
          }
          if (pr.error) return <span>music unknown</span>;
          if (pr.presentCount >= total) {
            return (
              <>
                <Icon name={IconNames.checkCircle} size={11} />
                <span>has this music</span>
              </>
            );
          }
          if (pr.presentCount > 0) {
            return (
              <span>
                has {pr.presentCount}/{total}
              </span>
            );
          }
          return null;
        })()}
      </span>
    </Show>
  );
};

// resolve a destination's brand image url. handles p2p (blob_id +
// resolveBlobUrl), http (image_url, possibly base_url-prefixed), and the
// synthetic local case (no image). returns an accessor.
function createImageUrl(entry: DestEntry): () => string | null {
  const remote = entry.candidate?.remote;
  if (!remote) return () => null;

  const isP2P = isP2PRemote(remote);

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
