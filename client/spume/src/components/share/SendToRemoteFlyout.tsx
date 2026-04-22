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

  let containerRef: HTMLDivElement | undefined;
  let panelRef: HTMLDivElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;

  // panel position in viewport coords (fixed). recomputed on open + resize.
  const [panelPos, setPanelPos] = createSignal<{ left: number; top: number }>({
    left: 0,
    top: 0,
  });

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
    let top = trig.bottom + gap;
    if (top + panel.height > vh - margin) {
      const above = trig.top - gap - panel.height;
      top = above >= margin ? above : Math.max(margin, vh - margin - panel.height);
    }

    setPanelPos({ left, top });
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
  });

  // reposition whenever the panel mounts or the eligible list changes size.
  createEffect(() => {
    if (!open()) return;
    // touch the deps that affect panel size.
    void eligible().length;
    void progress();
    // wait a tick so the panel is laid out before measuring.
    queueMicrotask(repositionPanel);
  });

  const handleSend = async (entry: EligibleRemote) => {
    const src = props.source();
    if (!src) {
      toast.error("source remote unavailable");
      return;
    }
    setActiveDestId(entry.remote.remote_id);
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
    try {
      const payload = props.buildPayload();
      const final = await sendToRemote(payload, src, entry.remote, {
        onProgress: (p) => setProgress(p),
      });
      const summary =
        `sent to ${entry.remote.name ?? entry.remote.remote_id}: ` +
        `${final.syncedSongs} synced, ${final.skippedSongs} skipped, ` +
        `${final.failedSongs} failed`;
      if (final.failedSongs > 0) {
        toast.warning(summary);
      } else {
        toast.success(summary);
      }
    } catch (e) {
      toast.error(`send failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setActiveDestId(null);
      setProgress(null);
      setOpen(false);
    }
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
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              left: `${panelPos().left}px`,
              top: `${panelPos().top}px`,
              "max-height": `calc(100vh - 16px)`,
              "overflow-y": "auto",
            }}
            class="z-50 min-w-[16rem] max-w-xs bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-xl py-1"
          >
            <div class="px-3 py-2 text-xs uppercase tracking-wide text-[var(--color-text-tertiary)] border-b border-[var(--color-border-default)]">
              send to remote
            </div>
            <For each={eligible()}>
              {(entry) => {
                const isActive = () => activeDestId() === entry.remote.remote_id;
                const p = () => progress();
                return (
                  <button
                    type="button"
                    disabled={!!activeDestId()}
                    onClick={() => handleSend(entry)}
                    class="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm text-left hover:bg-[var(--color-bg-tertiary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
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
                  </button>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
};
