import { useNavigate } from "@solidjs/router";
import { For, onMount, Show } from "solid-js";
import { toast } from "../../components/feedback/Toast";
import { Icon } from "../../components/icons/registry";
import { getRemoteByPeerAddr } from "../../app/services/remotes/remoteManager";
import { getDefaultRoute } from "../utils/routing";
import { setHighlightedSongId } from "../state/highlightedSong";
import { startSharedRadioStation } from "../../components/share/startSharedRadioStation";
import {
  clearSharedItems,
  deleteSharedItem,
  loadSharedItems,
  sharedItems,
} from "../../app/services/storage/sharedItems";
import type { SharedItemEntry } from "../../app/services/storage/types";

function kindLabel(kind: SharedItemEntry["kind"]): string {
  switch (kind) {
    case "radio_station":
      return "radio station";
    default:
      return kind;
  }
}

function formatRelative(ts: number): string {
  const deltaSec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const min = Math.floor(deltaSec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function SharedItemsView() {
  const navigate = useNavigate();

  onMount(() => {
    void loadSharedItems();
  });

  const openShare = (token: string) => {
    navigate(`/shared?share=${encodeURIComponent(token)}`);
  };

  const openRemoteItem = async (item: SharedItemEntry) => {
    if (item.kind === "radio_station") {
      if (!item.source_node_id) {
        openShare(item.token);
        return;
      }
      await startSharedRadioStation({
        nodeId: item.source_node_id,
        stationId: item.entity_id,
        stationName: item.title,
      });
      return;
    }

    if (!item.source_node_id) {
      openShare(item.token);
      return;
    }

    const remote = await getRemoteByPeerAddr(item.source_node_id);
    if (!remote) {
      openShare(item.token);
      return;
    }

    if (item.kind === "song" && item.parent_id) {
      setHighlightedSongId(item.entity_id);
    }
    navigate(entityRouteFor(item, remote.remote_id));
  };

  const copyShare = async (token: string) => {
    const url = `${window.location.origin}${window.location.pathname}#?share=${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("copied share url");
    } catch {
      toast.error("failed to copy share url");
    }
  };

  return (
    <div class="h-full overflow-y-auto p-4 wide:p-6">
      <div class="max-w-4xl mx-auto space-y-4">
        <header class="flex items-center justify-between gap-3 wide:ml-16 pb-3">
          <div>
            <h1 class="text-xl font-semibold m-0">share'd</h1>
            <p class="text-sm text-[var(--color-text-secondary)] m-0 mt-1">
              stuff that's been shared with you
            </p>
          </div>
          <Show when={sharedItems().length > 0}>
            <button
              type="button"
              class="px-3 py-1.5 text-xs rounded border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]"
              onClick={() => void clearSharedItems()}
            >
              clear all
            </button>
          </Show>
        </header>

        <Show
          when={sharedItems().length > 0}
          fallback={
            <div class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)]/50 p-6 text-sm text-[var(--color-text-secondary)]">
              no shared itemz yet.
            </div>
          }
        >
          <ul class="space-y-2">
            <For each={sharedItems()}>
              {(item) => (
                <li class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)]/40 p-3">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="text-sm font-medium text-[var(--color-text-primary)] truncate">
                        {item.title || item.entity_id}
                      </div>
                      <div class="text-xs text-[var(--color-text-secondary)] mt-1">
                        {kindLabel(item.kind)} · seen {item.seen_count}x ·{" "}
                        {formatRelative(item.last_seen_at)}
                      </div>
                      {/* <div class="text-xs text-[var(--color-text-tertiary)] mt-1 truncate">
                        source {item.source_node_id || item.source_http_origin || "unknown"}
                      </div> */}
                    </div>
                    <div class="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        class="p-2 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                        onClick={() => void openRemoteItem(item)}
                        title={item.kind === "radio_station" ? "play radio station" : "open item"}
                        aria-label={
                          item.kind === "radio_station" ? "play radio station" : "open item"
                        }
                      >
                        <Icon
                          name={item.kind === "radio_station" ? "radioTower" : "arrowRight"}
                          size={16}
                        />
                      </button>
                      {/* <button
                        type="button"
                        class="p-2 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                        onClick={() => openShare(item.token)}
                        title="open"
                        aria-label="open"
                      >
                        <Icon name="externalLink" size={16} />
                      </button> */}
                      <button
                        type="button"
                        class="p-2 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                        onClick={() => void copyShare(item.token)}
                        title="copy share url"
                        aria-label="copy share url"
                      >
                        <Icon name="share" size={16} />
                      </button>
                      <button
                        type="button"
                        class="p-2 rounded hover:bg-red-500/15 text-[var(--color-text-secondary)] hover:text-red-400"
                        onClick={() => void deleteSharedItem(item.id)}
                        title="remove"
                        aria-label="remove"
                      >
                        <Icon name="close" size={16} />
                      </button>
                    </div>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  );
}

function entityRouteFor(item: SharedItemEntry, remoteId: string): string {
  switch (item.kind) {
    case "album":
      return `/${remoteId}/albums/${encodeURIComponent(item.entity_id)}`;
    case "playlist":
      return `/${remoteId}/playlists/${encodeURIComponent(item.entity_id)}`;
    case "artist":
      return `/${remoteId}/artists/${encodeURIComponent(item.entity_id)}`;
    case "song":
      if (item.parent_id) {
        return `/${remoteId}/albums/${encodeURIComponent(item.parent_id)}`;
      }
      return getDefaultRoute(remoteId);
    default:
      return getDefaultRoute(remoteId);
  }
}
