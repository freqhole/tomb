// reusable remote picker — chip strip for selecting one or many remotes.
//
// extracted from AggregateFeedView's remote-toggle strip so it can be reused
// by the library view (single-select today, multi-select later).
//
// modes:
//   - "multi": clicking toggles a remote in/out; long-press solos a remote
//              (selects only that one). enforces minimum 1 selected.
//   - "single": clicking selects exactly that remote; long-press is disabled.
//
// the component is presentational; the parent owns the `value` set and
// receives every change via `onChange`. callers also own how remotes are
// loaded — pass them in via `remotes`.
//
// overflow behavior (9b): when the chip strip would exceed the container
// width, the component collapses to a single trigger button that opens a
// flyout panel (desktop) or modal sheet (mobile ≤ 640px). keyboard: arrow
// keys navigate the list, space/enter toggle, esc closes and returns focus.

import {
  createEffect,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { Icon, IconNames } from "../icons/registry";
import { Modal } from "../modals/Modal";
import { resolveBlobUrl } from "../../music/services/storage/blobResolver";
import { type Remote, isP2PRemote } from "../../app/services/storage/schemas/remote";

export type RemotePickerMode = "single" | "multi";

interface RemotePickerProps {
  remotes: Remote[];
  /** currently-selected remote ids. for `single` mode, treat first entry. */
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  mode?: RemotePickerMode;
  /** when true, non-admin remotes will be visually de-emphasised + disabled.
   *  the parent is responsible for actually filtering admin status into the
   *  remotes list if it wants stricter behaviour. */
  isRemoteAdmin?: (remoteId: string) => boolean;
  /** floating layout = absolute-positioned strip (matches aggregate feed).
   *  inline layout = static flex row (good for header bars). */
  layout?: "floating" | "inline";
  /** extra class for the outer container */
  class?: string;
}

const LONG_PRESS_MS = 500;

export function RemotePicker(props: RemotePickerProps) {
  const mode = () => props.mode ?? "multi";
  const layout = () => props.layout ?? "inline";

  // ── overflow / flyout state (9b) ────────────────────────────────────────────
  let wrapperRef: HTMLDivElement | undefined;
  let chipContainerRef: HTMLDivElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;
  // total chip content width measured once on mount; used to detect overflow
  // as the container is resized without needing to re-render the chips.
  let storedChipsWidth = 0;

  const [isOverflowing, setIsOverflowing] = createSignal(false);
  const [flyoutOpen, setFlyoutOpen] = createSignal(false);
  const [flyoutPos, setFlyoutPos] = createSignal<{ top: number; left: number } | null>(null);
  const [focusedIndex, setFocusedIndex] = createSignal(-1);
  const [isMobile, setIsMobile] = createSignal(
    typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches
  );

  onMount(() => {
    // track mobile breakpoint
    const mq = window.matchMedia("(max-width: 640px)");
    const mqH = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", mqH);

    // watch wrapper width to detect overflow.
    // +225 so the picker collapses before the nav bar overlaps the chips.
    // re-measures chip content width on every call so async-loaded remotes
    // (getAllRemotes is async) are accounted for after the chips render.
    const checkOverflow = () => {
      if (!wrapperRef) return;
      if (chipContainerRef) {
        const w = chipContainerRef.scrollWidth;
        if (w > 0) storedChipsWidth = w;
      }
      if (storedChipsWidth === 0) return;
      setIsOverflowing(wrapperRef.clientWidth < storedChipsWidth + 225);
    };
    if (wrapperRef) {
      const obs = new ResizeObserver(checkOverflow);
      obs.observe(wrapperRef);
      window.addEventListener("resize", checkOverflow);
      onCleanup(() => {
        obs.disconnect();
        window.removeEventListener("resize", checkOverflow);
        mq.removeEventListener("change", mqH);
      });
    } else {
      onCleanup(() => mq.removeEventListener("change", mqH));
    }

    // re-check overflow when remotes are loaded (getAllRemotes is async;
    // chipContainerRef.scrollWidth is 0 at mount when remotes haven't loaded yet)
    createEffect(() => {
      const _ = props.remotes.length; // track dependency
      queueMicrotask(checkOverflow);
    });
  });

  // ── selection helpers ──────────────────────────────────────────────────────
  const isActive = (remoteId: string) => props.value.has(remoteId);

  const select = (remoteId: string) => {
    if (mode() === "single") {
      props.onChange(new Set([remoteId]));
      // close flyout after single-select pick
      closeFlyout();
      return;
    }
    const next = new Set(props.value);
    if (next.has(remoteId)) {
      // enforce minimum 1
      if (next.size <= 1) return;
      next.delete(remoteId);
    } else {
      next.add(remoteId);
    }
    props.onChange(next);
  };

  const solo = (remoteId: string) => {
    props.onChange(new Set([remoteId]));
  };

  const isLocked = (remoteId: string) =>
    props.isRemoteAdmin ? !props.isRemoteAdmin(remoteId) : false;

  // ── flyout helpers ───────────────────────────────────────────────────────
  const closeFlyout = () => {
    setFlyoutOpen(false);
    triggerRef?.focus();
  };

  const openFlyout = () => {
    setFocusedIndex(-1);
    if (triggerRef) {
      const rect = triggerRef.getBoundingClientRect();
      setFlyoutPos({ top: rect.bottom + 4, left: rect.left });
    }
    setFlyoutOpen(true);
  };

  const handleFlyoutKey = (e: KeyboardEvent) => {
    const count = props.remotes.length;
    if (e.key === "Escape") {
      e.preventDefault();
      closeFlyout();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((i) => (i + 1) % count);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => (i - 1 + count) % count);
    }
  };

  const selectedLabel = () => {
    const names = [...props.value].map(
      (id) => props.remotes.find((r) => r.remote_id === id)?.name ?? id
    );
    if (names.length === 0) return "remotes";
    const joined = names.join(", ");
    return joined.length > 22 ? joined.slice(0, 21) + "…" : joined;
  };

  // ── render ──────────────────────────────────────────────────────────────
  // both floating and inline layouts share the same overflow-aware render path
  // so that ResizeObserver / window resize can correctly attach to wrapperRef
  // and chipContainerRef in both cases.

  const outerClass = () =>
    layout() === "floating"
      ? `absolute top-0 left-0 right-0 z-50 bg-transparent pointer-events-none flex items-center py-2 px-4 ${props.class ?? ""}`
      : `relative flex items-center ${props.class ?? ""}`;

  const chipStripClass = () =>
    layout() === "floating"
      ? "flex gap-2 flex-nowrap pointer-events-auto"
      : "flex gap-2 overflow-x-auto scrollbar-hide flex-nowrap py-1";

  return (
    <div ref={wrapperRef} class={outerClass()}>
      {/* spacer pushes chips to the right edge in floating layout */}
      <Show when={layout() === "floating"}>
        <div class="flex-1 shrink-0" />
      </Show>

      {/* chip strip — rendered for overflow measurement; hidden when overflowing */}
      <Show when={!isOverflowing()}>
        <div ref={chipContainerRef} class={chipStripClass()}>
          <For each={props.remotes}>
            {(remote) => (
              <RemoteChip
                remote={remote}
                isActive={isActive(remote.remote_id)}
                isLocked={isLocked(remote.remote_id)}
                mode={mode()}
                onSelect={() => select(remote.remote_id)}
                onSolo={() => solo(remote.remote_id)}
              />
            )}
          </For>
        </div>
      </Show>

      {/* collapsed trigger — shown when chip strip overflows the container */}
      <Show when={isOverflowing()}>
        <button
          ref={triggerRef}
          type="button"
          onClick={openFlyout}
          class={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated-hover)] hover:text-[var(--color-text-primary)] cursor-pointer shrink-0${layout() === "floating" ? " pointer-events-auto" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={flyoutOpen()}
          title="pick remote"
        >
          {selectedLabel()}
          <Icon name="chevronDown" size={12} />
        </button>

        {/* desktop flyout via Portal, anchored to trigger */}
        <Show when={!isMobile() && flyoutOpen()}>
          <Portal>
            <div class="fixed inset-0 z-40" onClick={closeFlyout} />
            <div
              class="fixed z-50 bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)] rounded-lg shadow-xl overflow-y-auto max-h-72 min-w-44 py-1"
              style={{
                top: `${flyoutPos()?.top ?? 0}px`,
                left: `${flyoutPos()?.left ?? 0}px`,
              }}
              role="listbox"
              aria-label="select remote"
              tabIndex={-1}
              onKeyDown={handleFlyoutKey}
            >
              <RemoteFlyoutList
                remotes={props.remotes}
                value={props.value}
                mode={mode()}
                focusedIndex={focusedIndex()}
                onSelect={select}
                isLocked={isLocked}
              />
            </div>
          </Portal>
        </Show>

        {/* mobile modal sheet */}
        <Show when={isMobile()}>
          <Modal isOpen={flyoutOpen()} onClose={closeFlyout} title="select remote" size="sm">
            <div class="py-1">
              <RemoteFlyoutList
                remotes={props.remotes}
                value={props.value}
                mode={mode()}
                focusedIndex={focusedIndex()}
                onSelect={select}
                isLocked={isLocked}
              />
            </div>
          </Modal>
        </Show>
      </Show>
    </div>
  );
}

// ── RemoteFlyoutList ────────────────────────────────────────────────────────────────
// shared vertical list body used by both the desktop flyout and the mobile modal.
function RemoteFlyoutList(props: {
  remotes: Remote[];
  value: Set<string>;
  mode: RemotePickerMode;
  focusedIndex: number;
  onSelect: (remoteId: string) => void;
  isLocked: (remoteId: string) => boolean;
}) {
  return (
    <For each={props.remotes}>
      {(remote, i) => {
        const active = () => props.value.has(remote.remote_id);
        const locked = () => props.isLocked(remote.remote_id);
        const focused = () => i() === props.focusedIndex;

        // image resolution — same logic as RemoteChip
        const isP2P = () => isP2PRemote(remote);
        const remoteImageUrl = () => {
          const url = remote.image_url;
          if (!url) return null;
          if (
            url.startsWith("http://") ||
            url.startsWith("https://") ||
            url.startsWith("asset://")
          ) {
            return url;
          }
          if (!isP2P() && remote.base_url) return `${remote.base_url}${url}`;
          return null;
        };
        const [resolvedBlob] = createResource(
          () =>
            isP2P() && remote.image_blob_id
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
        const imageUrl = () => (isP2P() ? resolvedBlob() : remoteImageUrl());
        const [imgError, setImgError] = createSignal(false);

        return (
          <button
            type="button"
            role="option"
            aria-selected={active()}
            disabled={locked()}
            class="w-full flex items-center gap-2.5 px-2 py-1.5 text-sm text-left border-none bg-transparent"
            classList={{
              "text-[var(--color-accent-500)] bg-[var(--color-accent-500)]/8": active(),
              "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] cursor-pointer":
                !active() && !locked(),
              "outline outline-1 outline-[var(--color-accent-500)] rounded": focused(),
              "opacity-40 cursor-not-allowed": locked(),
            }}
            onClick={() => !locked() && props.onSelect(remote.remote_id)}
            tabIndex={focused() ? 0 : -1}
          >
            {/* selection dot — always visible regardless of image */}
            <span
              class={`w-3 h-3 rounded-full border-2 flex-shrink-0 transition-colors ${
                active()
                  ? "border-[var(--color-accent-500)] bg-[var(--color-accent-500)]"
                  : "border-[var(--color-border-default)]"
              }`}
            />
            {/* avatar image when available */}
            <Show when={imageUrl() && !imgError()}>
              <img
                src={imageUrl()!}
                alt=""
                class="w-5 h-5 rounded object-cover flex-shrink-0"
                referrerpolicy="no-referrer"
                onError={() => setImgError(true)}
              />
            </Show>
            <span class="truncate">{remote.name}</span>
          </button>
        );
      }}
    </For>
  );
}

interface RemoteChipProps {
  remote: Remote;
  isActive: boolean;
  isLocked: boolean;
  mode: RemotePickerMode;
  onSelect: () => void;
  onSolo: () => void;
}

function RemoteChip(props: RemoteChipProps) {
  const isP2P = () => isP2PRemote(props.remote);

  const remoteImageUrl = () => {
    const url = props.remote.image_url;
    if (!url) return null;
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("asset://")) {
      return url;
    }
    if (!isP2P() && props.remote.base_url) {
      return `${props.remote.base_url}${url}`;
    }
    return null;
  };

  const [resolvedBlob] = createResource(
    () =>
      isP2P() && props.remote.image_blob_id
        ? { blobId: props.remote.image_blob_id, remoteId: props.remote.remote_id }
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

  const imageUrl = () => (isP2P() ? resolvedBlob() : remoteImageUrl());
  const [imgError, setImgError] = createSignal(false);

  // long press → solo (multi mode only)
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let didLongPress = false;

  const startPress = (e: Event) => {
    e.stopPropagation();
    didLongPress = false;
    if (props.mode !== "multi") return;
    pressTimer = setTimeout(() => {
      didLongPress = true;
      props.onSolo();
    }, LONG_PRESS_MS);
  };
  const endPress = (e: Event) => {
    e.stopPropagation();
    clearTimeout(pressTimer);
  };
  const handleClick = (e: Event) => {
    e.stopPropagation();
    if (props.isLocked) return;
    if (!didLongPress) {
      props.onSelect();
    }
  };

  const titleText = () => {
    const transport = props.remote.is_charnel_managed ? "" : isP2P() ? "" : " (http)";
    const hint = props.mode === "multi" ? "\nlong press to solo" : "";
    const lock = props.isLocked ? "\nrequires admin" : "";
    return `${props.remote.name}${transport}${hint}${lock}`;
  };

  return (
    <button
      type="button"
      disabled={props.isLocked}
      class={`text-sm rounded-lg transition-all whitespace-nowrap flex items-center justify-center gap-1.5 shrink-0 pointer-events-auto overflow-hidden ${
        imageUrl() && !imgError() ? "pl-0 pr-3 py-0" : "px-3 py-1.5"
      } ${
        props.isActive
          ? "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)]"
          : "bg-[var(--color-bg-elevated)] text-[var(--color-text-disabled)] hover:bg-[var(--color-bg-elevated-hover)] hover:text-[var(--color-text-secondary)]"
      } ${props.isLocked ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      onMouseDown={startPress}
      onMouseUp={endPress}
      onMouseLeave={endPress}
      onTouchStart={startPress}
      onTouchEnd={endPress}
      onClick={handleClick}
      onContextMenu={(e) => e.preventDefault()}
      title={titleText()}
      style={{ height: "32px" }}
    >
      <Show when={imageUrl() && !imgError()} fallback={<Icon name={IconNames.recent} size={14} />}>
        <img
          src={imageUrl()!}
          alt=""
          class="h-full rounded-l-lg object-cover flex-shrink-0"
          style={{ width: "auto" }}
          onError={() => setImgError(true)}
        />
      </Show>
      <span>{props.remote.name}</span>
      <Show when={props.remote.is_charnel_managed}>
        <Icon
          name="home"
          size={12}
          color={props.isActive ? "var(--color-text-on-accent)" : "var(--color-text-muted)"}
        />
      </Show>
      <Show when={!isP2P() && !props.remote.is_charnel_managed}>
        <span
          class={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
            props.isActive ? "bg-[var(--color-text-on-accent)]/20" : "bg-blue-600/20 text-blue-400"
          }`}
        >
          http
        </span>
      </Show>
    </button>
  );
}
