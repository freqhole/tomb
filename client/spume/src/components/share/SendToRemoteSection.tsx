// "send to remote" section of the share modal.
//
// drives a `sendToRemote` orchestrator run against a chosen destination
// remote. shows a list of eligible destinations (filtered by source +
// transport), an inline progress bar while a run is active, and a results
// summary with a "retry failed" affordance after completion.
//
// hidden entirely when there are no eligible destinations OR the source
// is not a p2p remote (send-to is iroh-blobs only — see plan step 5).

import { createMemo, createSignal, For, Show, type Component } from "solid-js";
import { toast } from "../feedback/Toast";
import {
  createEligibleRemotes,
  type EligibleRemote,
} from "../../music/services/send/eligibleRemotes";
import {
  sendToRemote,
  type SendPayload,
  type SendProgress,
} from "../../music/services/send/sendToRemote";
import { isP2PRemote, type Remote } from "../../app/services/storage/schemas/remote";

export interface SendToRemoteSectionProps {
  /** the source remote — the data being sent originates from here. */
  source: Remote;
  /** lazily build the payload to send (album or playlist). */
  buildPayload: () => SendPayload;
}

export const SendToRemoteSection: Component<SendToRemoteSectionProps> = (props) => {
  const eligible = createEligibleRemotes({
    sourceRemoteId: () => props.source.remote_id,
  });

  const sourceUsable = createMemo(() => isP2PRemote(props.source));

  const [activeDestId, setActiveDestId] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal<SendProgress | null>(null);
  // last completed run, keyed by dest remote_id — drives the results view.
  const [lastResult, setLastResult] = createSignal<{
    destRemoteId: string;
    destName: string;
    progress: SendProgress;
  } | null>(null);

  const runForRemote = async (entry: EligibleRemote, retryBlake3s?: string[]) => {
    setActiveDestId(entry.remote.remote_id);
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
    const destName = entry.remote.name ?? entry.remote.remote_id;
    try {
      const payload = props.buildPayload();
      const final = await sendToRemote(payload, props.source, entry.remote, {
        onProgress: (p) => setProgress(p),
        retryBlake3s,
      });
      const summary =
        `sent to ${destName}: ` +
        `${final.syncedSongs} synced, ${final.skippedSongs} skipped, ` +
        `${final.failedSongs} failed`;
      if (final.failedSongs > 0) toast.warning(summary);
      else toast.success(summary);
      setLastResult({
        destRemoteId: entry.remote.remote_id,
        destName,
        progress: final,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`send to ${destName} failed: ${msg}`);
      // capture in-progress snapshot so the user can retry partial work.
      const snapshot = progress();
      if (snapshot) {
        setLastResult({
          destRemoteId: entry.remote.remote_id,
          destName,
          progress: snapshot,
        });
      }
    } finally {
      setActiveDestId(null);
      setProgress(null);
    }
  };

  const handleSend = (entry: EligibleRemote) => void runForRemote(entry);

  const handleRetryFailed = () => {
    const last = lastResult();
    if (!last) return;
    const failed = last.progress.failedBlake3s;
    if (failed.length === 0) return;
    const entry = eligible().find((e) => e.remote.remote_id === last.destRemoteId);
    if (!entry) return;
    void runForRemote(entry, failed);
  };

  return (
    <Show when={sourceUsable() && eligible().length > 0}>
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
            <For each={eligible()}>
              {(entry) => {
                const isActive = () => activeDestId() === entry.remote.remote_id;
                const p = () => progress();
                const pct = () => {
                  const prog = p();
                  if (!prog || prog.totalSongs === 0) return 0;
                  const done = prog.syncedSongs + prog.skippedSongs + prog.failedSongs;
                  return Math.min(100, Math.round((done / prog.totalSongs) * 100));
                };
                return (
                  <li>
                    <button
                      type="button"
                      disabled={!!activeDestId()}
                      onClick={() => handleSend(entry)}
                      class="w-full flex flex-col gap-1 px-3 py-2 text-sm text-left rounded-md hover:bg-[var(--color-bg-tertiary)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed border border-[var(--color-border-default)]"
                    >
                      <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0">
                          <div class="truncate text-[var(--color-text-primary)]">
                            {entry.remote.name ?? entry.remote.remote_id}
                          </div>
                          <div class="truncate text-xs text-[var(--color-text-tertiary)]">
                            {entry.role}
                          </div>
                        </div>
                        <Show when={isActive() && p()}>
                          <span class="text-xs text-[var(--color-text-secondary)] whitespace-nowrap">
                            {p()!.phase} {p()!.syncedSongs}/{p()!.totalSongs}
                          </span>
                        </Show>
                      </div>
                      <Show when={isActive() && p() && p()!.totalSongs > 0}>
                        <div class="h-1 w-full bg-[var(--color-bg-tertiary)] rounded overflow-hidden">
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
