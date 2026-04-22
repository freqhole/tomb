// minimal popover-style "send to remote" flyout used by album / playlist
// toolbars. when there are no eligible destinations the trigger renders
// nothing — the surrounding layout sees a no-op.
//
// the flyout owns:
//   - the eligible-remotes list (derived signal)
//   - the open/closed state
//   - the per-destination send progress (one at a time for now)
//
// step 14 of the SEND_TO_REMOTE_PLAN folds this UI into the unified share
// modal; until then it's a standalone trigger.

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type Component,
} from "solid-js";
import { Portal } from "solid-js/web";
import { toast } from "../feedback/Toast";
import { Icon } from "../icons/registry";
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

export interface SendToRemoteFlyoutProps {
  /** the source remote — the data being sent originates from here. */
  source: () => Remote | null | undefined;
  /** the payload to send (album or playlist). called when user clicks send. */
  buildPayload: () => SendPayload;
  /** optional class for the trigger button. */
  class?: string;
}

export const SendToRemoteFlyout: Component<SendToRemoteFlyoutProps> = (props) => {
  const eligible = createEligibleRemotes({
    sourceRemoteId: () => props.source()?.remote_id,
  });

  // gate the entire trigger on having a p2p source — local-source sends
  // are deferred to a later batch.
  const sourceUsable = createMemo(() => {
    const s = props.source();
    return !!s && isP2PRemote(s);
  });

  const [open, setOpen] = createSignal(false);
  const [activeDestId, setActiveDestId] = createSignal<string | null>(null);
  const [progress, setProgress] = createSignal<SendProgress | null>(null);
  // last completed run, keyed by dest remote_id. used to render the
  // post-run summary (synced/skipped/failed) + retry-failed affordance.
  const [lastResult, setLastResult] = createSignal<{
    destRemoteId: string;
    destName: string;
    progress: SendProgress;
  } | null>(null);

  let containerRef: HTMLDivElement | undefined;
  let panelRef: HTMLDivElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;
  let panelResizeObserver: ResizeObserver | undefined;

  // panel position in viewport coords (fixed). recomputed on open + resize.
  // `measured` gates visibility so we never paint the panel at (0,0) before
  // the first measurement lands.
  const [panelPos, setPanelPos] = createSignal<{
    left: number;
    top: number;
    measured: boolean;
  }>({ left: 0, top: 0, measured: false });

  const repositionPanel = () => {
    if (!triggerRef || !panelRef) return;
    const margin = 8; // px gap from viewport edges
    const gap = 4; // px gap below trigger
    const trig = triggerRef.getBoundingClientRect();
    const panel = panelRef.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // prefer right-aligned to trigger; clamp into viewport.
    let left = trig.right - panel.width;
    if (left + panel.width > vw - margin) left = vw - margin - panel.width;
    if (left < margin) left = margin;

    // prefer below trigger; flip above when it would overflow bottom.
    // also flip when there's more room above than below (covers the case
    // where the trigger is in the lower half of the viewport but `below`
    // technically fits — we still want the panel anchored visibly).
    const spaceBelow = vh - margin - (trig.bottom + gap);
    const spaceAbove = trig.top - gap - margin;
    const wantsFlip =
      panel.height > spaceBelow || (panel.height > spaceBelow * 0.9 && spaceAbove > spaceBelow);

    let top = trig.bottom + gap;
    if (wantsFlip) {
      const above = trig.top - gap - panel.height;
      if (above >= margin) {
        top = above;
      } else if (spaceAbove > spaceBelow) {
        // not enough room above either, but above has more room — pin to
        // top margin (panel's max-height clamp will scroll its body).
        top = margin;
      } else {
        // pin to bottom margin (panel's max-height clamp will scroll).
        top = Math.max(margin, vh - margin - panel.height);
      }
    }

    setPanelPos({ left, top, measured: true });
  };

  const onDocClick = (e: MouseEvent) => {
    if (!containerRef) return;
    const target = e.target as Node;
    if (containerRef.contains(target)) return;
    if (panelRef && panelRef.contains(target)) return;
    setOpen(false);
  };
  const onWinChange = () => {
    if (open()) repositionPanel();
  };
  onMount(() => {
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("resize", onWinChange);
    window.addEventListener("scroll", onWinChange, true);
  });
  onCleanup(() => {
    document.removeEventListener("mousedown", onDocClick);
    window.removeEventListener("resize", onWinChange);
    window.removeEventListener("scroll", onWinChange, true);
    panelResizeObserver?.disconnect();
  });

  // reset measurement state when the panel closes so the next open
  // re-measures from scratch (and stays hidden until we have real coords).
  createEffect(() => {
    if (!open()) {
      setPanelPos({ left: 0, top: 0, measured: false });
      panelResizeObserver?.disconnect();
      panelResizeObserver = undefined;
    }
  });

  // reposition after the panel is mounted and laid out. uses rAF so the
  // browser has actually performed layout before we measure (microtasks
  // can fire too early). also hooks a ResizeObserver so any later content
  // size change (e.g. progress text expanding the row) reflows the panel.
  createEffect(() => {
    if (!open()) return;
    // touch deps that affect panel size so the effect re-runs.
    void eligible().length;
    void progress();
    requestAnimationFrame(() => {
      repositionPanel();
      // attach resize observer once.
      if (!panelResizeObserver && panelRef && typeof ResizeObserver !== "undefined") {
        panelResizeObserver = new ResizeObserver(() => repositionPanel());
        panelResizeObserver.observe(panelRef);
      }
    });
  });

  const runForRemote = async (entry: EligibleRemote, retryBlake3s?: string[]) => {
    const src = props.source();
    if (!src) {
      toast.error("source remote unavailable");
      return;
    }
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
      const final = await sendToRemote(payload, src, entry.remote, {
        onProgress: (p) => setProgress(p),
        retryBlake3s,
      });
      const summary =
        `sent to ${destName}: ` +
        `${final.syncedSongs} synced, ${final.skippedSongs} skipped, ` +
        `${final.failedSongs} failed`;
      if (final.failedSongs > 0) {
        toast.warning(summary);
      } else {
        toast.success(summary);
      }
      setLastResult({
        destRemoteId: entry.remote.remote_id,
        destName,
        progress: final,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`send to ${destName} failed: ${msg}`);
      // capture the in-progress snapshot so the user sees what failed
      // and can retry the song subset if any partial work happened.
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

  const handleSend = (entry: EligibleRemote) => runForRemote(entry);

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
      <div ref={containerRef} class="relative inline-block">
        <button
          ref={triggerRef}
          type="button"
          aria-label="send to remote"
          title="send to remote"
          onClick={() => setOpen((v) => !v)}
          class={
            props.class ??
            "p-2 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
          }
        >
          <Icon name="send" size={18} />
        </button>
        <Show when={open()}>
          {/*
            portal into <body> so the fixed-positioned panel escapes any
            ancestor that creates a containing block for fixed elements
            (transform/filter/backdrop-filter/will-change/contain). without
            this, the toolbar's `backdrop-blur-sm` traps the panel and our
            "fixed" coords end up resolving relative to the toolbar, not
            the viewport.
          */}
          <Portal>
            <div
              ref={panelRef}
              style={{
                position: "fixed",
                left: `${panelPos().left}px`,
                top: `${panelPos().top}px`,
                "max-height": `calc(100vh - 16px)`,
                "overflow-y": "auto",
                // hide until first measurement to avoid a (0,0) flicker.
                visibility: panelPos().measured ? "visible" : "hidden",
              }}
              class="z-50 min-w-[16rem] max-w-xs bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-xl py-1"
            >
              <div class="px-3 py-2 text-xs uppercase tracking-wide text-[var(--color-text-tertiary)] border-b border-[var(--color-border-default)] flex items-center justify-between gap-2">
                <span>send to remote</span>
                <Show when={!!lastResult() || !!activeDestId()}>
                  <button
                    type="button"
                    class="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] text-xs normal-case tracking-normal"
                    onClick={() => {
                      setLastResult(null);
                      setOpen(false);
                    }}
                    disabled={!!activeDestId()}
                  >
                    close
                  </button>
                </Show>
              </div>

              {/* RESULTS VIEW: shown after a run completes (success or failure). */}
              <Show when={lastResult() && !activeDestId()}>
                {(() => {
                  const r = lastResult()!;
                  const p = r.progress;
                  const ok = p.failedSongs === 0 && p.phase !== "failed";
                  return (
                    <div class="px-3 py-3 space-y-2 text-sm">
                      <div class="text-[var(--color-text-primary)]">
                        <span class="font-medium">{r.destName}</span>
                      </div>
                      <div class="text-xs text-[var(--color-text-secondary)] space-y-0.5">
                        <div>
                          <span class="text-[var(--color-text-tertiary)]">synced:</span>{" "}
                          {p.syncedSongs}/{p.totalSongs}
                        </div>
                        <Show when={p.skippedSongs > 0}>
                          <div>
                            <span class="text-[var(--color-text-tertiary)]">skipped:</span>{" "}
                            {p.skippedSongs}
                          </div>
                        </Show>
                        <Show when={p.failedSongs > 0}>
                          <div class="text-[var(--color-error)]">
                            <span class="text-[var(--color-text-tertiary)]">failed:</span>{" "}
                            {p.failedSongs}
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

              {/* LIST VIEW: default — pick a destination. also rendered while
                  a run is active so the user sees the inline progress next
                  to the destination they clicked. */}
              <Show when={!lastResult() || activeDestId()}>
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
                      <button
                        type="button"
                        disabled={!!activeDestId()}
                        onClick={() => handleSend(entry)}
                        class="w-full flex flex-col gap-1 px-3 py-2 text-sm text-left hover:bg-[var(--color-bg-tertiary)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
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
                    );
                  }}
                </For>
              </Show>
            </div>
          </Portal>
        </Show>
      </div>
    </Show>
  );
};
