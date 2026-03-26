import { For, Show } from "solid-js";
import type {
  GossipMessage,
  GossipReaction,
  MusicReference,
} from "../../../stories/gossip/mockGossipData";
import { formatRelativeTime, formatDateTime } from "../../utils/dateTime";
import { MusicRefCard } from "./MusicRefCard";

export interface GossipMessageCardProps {
  message: GossipMessage;
  /** current user's node id for "own message" styling */
  currentNodeId?: string;
  /** avatar image url for the sender */
  avatarUrl?: string | null;
  onReact?: (messageId: string, emoji: string) => void;
  onOpenReactionPicker?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  onPlay?: (item: MusicReference) => void;
  onFavorite?: (item: MusicReference) => void;
  onAddToQueue?: (item: MusicReference) => void;
  onAddToPlaylist?: (item: MusicReference) => void;
  /** read this signal to trigger periodic re-render of relative timestamps */
  tick?: number;
}

/** group reactions by emoji */
function groupReactions(
  reactions: GossipReaction[]
): { emoji: string; count: number; senders: string[] }[] {
  const map = new Map<string, string[]>();
  for (const r of reactions) {
    const existing = map.get(r.emoji) || [];
    existing.push(r.sender_name || "unknown");
    map.set(r.emoji, existing);
  }
  return Array.from(map.entries()).map(([emoji, senders]) => ({
    emoji,
    count: senders.length,
    senders,
  }));
}

/** parse message payload */
function parsePayload(msg: GossipMessage): { text: string | null; items: MusicReference[] } {
  try {
    return JSON.parse(msg.payload);
  } catch {
    return { text: null, items: [] };
  }
}

export function GossipMessageCard(props: GossipMessageCardProps) {
  const isOwn = () => props.currentNodeId === props.message.sender_node_id;
  const isDeleted = () => props.message.deleted_at !== null;
  const payload = () => parsePayload(props.message);
  const grouped = () => groupReactions(props.message.reactions ?? []);
  const relativeTime = () => {
    void props.tick;
    return formatRelativeTime(props.message.timestamp * 1000);
  };
  const fullDateTime = () => formatDateTime(props.message.timestamp * 1000);
  const initials = () => (props.message.sender_name ?? "?")[0].toUpperCase();

  return (
    <div
      class="group flex gap-2.5 px-3 py-2 hover:bg-[var(--color-bg-secondary)] transition-colors rounded-lg"
      classList={{ "opacity-50": isDeleted() }}
    >
      {/* avatar */}
      <div class="flex-shrink-0 w-8 h-8 rounded-full overflow-hidden bg-[var(--color-bg-tertiary)] mt-0.5">
        <Show
          when={props.avatarUrl}
          fallback={
            <div class="w-full h-full flex items-center justify-center text-xs font-semibold text-[var(--color-text-tertiary)]">
              {initials()}
            </div>
          }
        >
          <img
            src={props.avatarUrl!}
            alt={props.message.sender_name ?? "avatar"}
            class="w-full h-full object-cover"
            loading="lazy"
          />
        </Show>
      </div>

      <div class="flex-1 min-w-0">
        {/* deleted state */}
        <Show when={isDeleted()}>
          <div class="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)] italic">
            <span class="font-medium text-[var(--color-text-secondary)]">
              {props.message.sender_name ?? "unknown"}
            </span>
            <span>deleted a message</span>
            <span class="ml-auto" title={fullDateTime()}>
              {relativeTime()}
            </span>
          </div>
        </Show>

        {/* normal message */}
        <Show when={!isDeleted()}>
          {/* header: sender + timestamp + actions */}
          <div class="flex items-baseline gap-2 mb-1">
            <span class="text-sm font-semibold text-[var(--color-text-primary)]">
              {props.message.sender_name ?? "unknown"}
            </span>
            <span class="text-[10px] text-[var(--color-text-tertiary)]" title={fullDateTime()}>
              {relativeTime()}
            </span>

            {/* hover actions */}
            <div class="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Show when={isOwn()}>
                <button
                  class="text-xs text-[var(--color-text-tertiary)] hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-[var(--color-bg-tertiary)] transition-colors"
                  onClick={() => props.onDelete?.(props.message.message_id)}
                  title="delete message"
                >
                  ×
                </button>
              </Show>
            </div>
          </div>

          {/* text content */}
          <Show when={payload().text}>
            <p class="text-sm text-[var(--color-text-secondary)] mb-2 leading-relaxed">
              {payload().text}
            </p>
          </Show>

          {/* music references */}
          <Show when={payload().items.length > 0}>
            <div class="flex flex-col gap-1.5 mb-2">
              <For each={payload().items}>
                {(item) => (
                  <MusicRefCard
                    item={item}
                    hasAccess={true}
                    onPlay={props.onPlay}
                    onFavorite={props.onFavorite}
                    onAddToQueue={props.onAddToQueue}
                    onAddToPlaylist={props.onAddToPlaylist}
                  />
                )}
              </For>
            </div>
          </Show>

          {/* reactions + add reaction button */}
          <div class="flex flex-wrap items-center gap-1 mt-1">
            <For each={grouped()}>
              {(group) => (
                <button
                  class="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-elevated)] transition-colors border border-transparent hover:border-[var(--color-accent-500)]/30"
                  onClick={() => props.onReact?.(props.message.message_id, group.emoji)}
                  title={group.senders.join(", ")}
                >
                  <span>{group.emoji}</span>
                  <span class="text-[var(--color-text-secondary)]">{group.count}</span>
                </button>
              )}
            </For>
            {/* add reaction — always visible as a placeholder pill at the end of reactions */}
            <button
              class="flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-elevated)] transition-colors border border-dashed border-[var(--color-text-tertiary)]/20 hover:border-[var(--color-accent-500)]/30 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              onClick={() => props.onOpenReactionPicker?.(props.message.message_id)}
              title="add reaction"
            >
              <span>+</span>
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
