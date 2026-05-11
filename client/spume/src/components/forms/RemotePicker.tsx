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

import { createResource, createSignal, For, Show } from "solid-js";
import { Icon, IconNames } from "../icons/registry";
import { resolveBlobUrl } from "../../music/services/storage/blobResolver";
import {
  type Remote,
  isP2PRemote,
} from "../../app/services/storage/schemas/remote";

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

  const isActive = (remoteId: string) => props.value.has(remoteId);

  const select = (remoteId: string) => {
    if (mode() === "single") {
      props.onChange(new Set([remoteId]));
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

  const containerClass = () => {
    const base = "flex gap-2 overflow-x-auto scrollbar-hide flex-nowrap";
    if (layout() === "floating") {
      return `${base} py-2 px-4 absolute top-0 left-0 right-0 z-50 bg-transparent pointer-events-none`;
    }
    return `${base} py-1 ${props.class ?? ""}`;
  };

  return (
    <div class={containerClass()}>
      <Show when={layout() === "floating"}>
        <div class="flex-1 shrink-0" />
      </Show>
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
    const transport = props.remote.is_charnel_managed
      ? ""
      : isP2P()
        ? ""
        : " (http)";
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
      <Show
        when={imageUrl() && !imgError()}
        fallback={<Icon name={IconNames.recent} size={14} />}
      >
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
          color={
            props.isActive ? "var(--color-text-on-accent)" : "var(--color-text-muted)"
          }
        />
      </Show>
      <Show when={!isP2P() && !props.remote.is_charnel_managed}>
        <span
          class={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
            props.isActive
              ? "bg-[var(--color-text-on-accent)]/20"
              : "bg-blue-600/20 text-blue-400"
          }`}
        >
          http
        </span>
      </Show>
    </button>
  );
}
