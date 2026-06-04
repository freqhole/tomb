// remote picker modal. mounted once in App.tsx. opens when a caller invokes
// `pickRemote(remotes)` from `app/services/remotePickerState.ts`.
//
// list rows reuse the same visual pattern as the RemotePicker flyout's
// avatar + name + selection dot layout.

import { createResource, createSignal, For, Show } from "solid-js";
import { Modal } from "./Modal";
import {
  remotePickerState,
  resolveRemotePicker,
  closeRemotePicker,
} from "../../app/services/remotePickerState";
import { resolveBlobUrl } from "../../music/services/storage/blobResolver";
import { type Remote, isP2PRemote } from "../../app/services/storage/schemas/remote";
import { formatRelativeTime } from "../../utils/dateTime";

export function RemotePickerModal() {
  return (
    <Modal
      isOpen={remotePickerState().isOpen}
      onClose={closeRemotePicker}
      title={remotePickerState().title ?? "select a remote"}
      size="sm"
      fitContent
    >
      <div class="p-3 flex flex-col gap-2">
        <Show when={remotePickerState().message}>
          <p class="text-sm text-[var(--color-text-secondary)] px-1">
            {remotePickerState().message}
          </p>
        </Show>
        <div class="flex flex-col">
          <For each={remotePickerState().remotes}>
            {(remote) => <RemoteRow remote={remote} onPick={() => resolveRemotePicker(remote)} />}
          </For>
        </div>
      </div>
    </Modal>
  );
}

function RemoteRow(props: { remote: Remote; onPick: () => void }) {
  const isP2P = () => isP2PRemote(props.remote);

  const remoteImageUrl = () => {
    const url = props.remote.image_url;
    if (!url) return null;
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("asset://")) {
      return url;
    }
    if (!isP2P() && props.remote.base_url) return `${props.remote.base_url}${url}`;
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

  const lastSeen = () => {
    const ts = props.remote.last_connected_at ?? props.remote.last_checked;
    return ts ? formatRelativeTime(ts) : null;
  };

  return (
    <button
      type="button"
      class="w-full flex items-center gap-3 px-3 py-2 text-left text-sm rounded border-none bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors"
      onClick={props.onPick}
    >
      <Show
        when={imageUrl() && !imgError()}
        fallback={
          <div class="w-8 h-8 rounded bg-[var(--color-bg-tertiary)] flex items-center justify-center text-xs font-medium text-[var(--color-text-tertiary)] flex-shrink-0">
            {(props.remote.name ?? "?").slice(0, 1).toUpperCase()}
          </div>
        }
      >
        <img
          src={imageUrl()!}
          alt=""
          class="w-8 h-8 rounded object-cover flex-shrink-0"
          referrerpolicy="no-referrer"
          onError={() => setImgError(true)}
        />
      </Show>
      <div class="flex-1 min-w-0 flex flex-col">
        <span class="truncate text-[var(--color-text-primary)]">
          {props.remote.name ?? props.remote.remote_id}
        </span>
        <Show when={lastSeen()}>
          <span class="text-[10px] text-[var(--color-text-tertiary)]">last seen {lastSeen()}</span>
        </Show>
      </div>
    </button>
  );
}
