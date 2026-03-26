import { createSignal, For, Show } from "solid-js";
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
  /** whether the sender is the channel creator */
  isCreator?: boolean;
  onReact?: (messageId: string, emoji: string) => void;
  onOpenReactionPicker?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  onPlay?: (item: MusicReference) => void;
  onFavorite?: (item: MusicReference) => void;
  onAddToQueue?: (item: MusicReference) => void;
  onAddToPlaylist?: (item: MusicReference) => void;
  /** lazy friendship checker — called when the three-dots menu opens */
  checkFriendship?: (nodeId: string) => "friend" | "not-friend" | "self" | "pending";
  onAddFriend?: (nodeId: string) => void;
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
    const parsed = JSON.parse(msg.payload);
    return { text: parsed.text ?? null, items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch {
    return { text: null, items: [] };
  }
}

export function GossipMessageCard(props: GossipMessageCardProps) {
  const isOwn = () => props.currentNodeId === props.message.sender_node_id;
  const isDeleted = () => props.message.deleted_at !== null;
  const isSystem = () => props.message.msg_type === "System";
  const payload = () => parsePayload(props.message);
  const grouped = () => groupReactions(props.message.reactions ?? []);
  const relativeTime = () => {
    void props.tick;
    return formatRelativeTime(props.message.timestamp * 1000);
  };
  const fullDateTime = () => formatDateTime(props.message.timestamp * 1000);
  const initials = () => (props.message.sender_name ?? "?")[0].toUpperCase();

  // three-dots menu state
  const [showMenu, setShowMenu] = createSignal(false);
  const [menuFriendStatus, setMenuFriendStatus] = createSignal<
    "friend" | "not-friend" | "self" | "pending" | null
  >(null);

  const openMenu = () => {
    setShowMenu(true);
    // lazy resolve friendship status
    if (props.checkFriendship) {
      setMenuFriendStatus(props.checkFriendship(props.message.sender_node_id));
    }
  };

  // system message rendering
  if (isSystem()) {
    const systemText = () => {
      try {
        return JSON.parse(props.message.payload).text ?? "";
      } catch {
        return "";
      }
    };
    return (
      <div class="flex items-center gap-3 px-3 py-1.5 my-0.5">
        <div class="flex-1 h-px bg-[var(--color-text-tertiary)]/15" />
        <span class="text-[10px] text-[var(--color-text-tertiary)]/60 whitespace-nowrap">
          {systemText()}
        </span>
        <div class="flex-1 h-px bg-[var(--color-text-tertiary)]/15" />
      </div>
    );
  }

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
          {/* header: sender + creator badge + timestamp + actions */}
          <div class="flex items-baseline gap-2 mb-1">
            <span class="text-sm font-semibold text-[var(--color-text-primary)]">
              {props.message.sender_name ?? "unknown"}
            </span>
            <Show when={props.isCreator}>
              <span class="text-[9px] font-medium text-[var(--color-accent-500)] bg-[var(--color-accent-500)]/10 px-1.5 py-0.5 rounded-full leading-none relative -top-px">
                creator
              </span>
            </Show>
            <span class="text-[10px] text-[var(--color-text-tertiary)]" title={fullDateTime()}>
              {relativeTime()}
            </span>

            {/* hover actions */}
            <div class="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {/* three-dots menu */}
              <div class="relative">
                <button
                  class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] px-1.5 py-0.5 rounded hover:bg-[var(--color-bg-tertiary)] transition-colors cursor-pointer"
                  onClick={openMenu}
                  title="more options"
                >
                  ···
                </button>
                <Show when={showMenu()}>
                  <div class="absolute right-0 top-full mt-1 w-40 bg-[var(--color-bg-elevated)] rounded-lg shadow-xl border border-[var(--color-border-primary)]/20 z-50 overflow-hidden py-1">
                    <Show when={menuFriendStatus() === "friend"}>
                      <div class="px-3 py-1.5 text-xs text-[var(--color-text-tertiary)]">
                        friends ✓
                      </div>
                    </Show>
                    <Show when={menuFriendStatus() === "pending"}>
                      <div class="px-3 py-1.5 text-xs text-[var(--color-text-tertiary)]">
                        request pending
                      </div>
                    </Show>
                    <Show when={menuFriendStatus() === "not-friend"}>
                      <button
                        class="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent-500)] hover:bg-[var(--color-bg-secondary)] transition-colors cursor-pointer"
                        onClick={() => {
                          props.onAddFriend?.(props.message.sender_node_id);
                          setMenuFriendStatus("pending");
                        }}
                      >
                        add friend
                      </button>
                    </Show>
                    <Show when={isOwn()}>
                      <button
                        class="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-[var(--color-bg-secondary)] transition-colors cursor-pointer"
                        onClick={() => {
                          props.onDelete?.(props.message.message_id);
                          setShowMenu(false);
                        }}
                      >
                        delete message
                      </button>
                    </Show>
                  </div>
                  <div class="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                </Show>
              </div>
              <Show when={isOwn()}>
                <button
                  class="text-xs text-[var(--color-text-tertiary)] hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-[var(--color-bg-tertiary)] transition-colors cursor-pointer"
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
                  class="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-elevated)] transition-colors border border-transparent hover:border-[var(--color-accent-500)]/30 cursor-pointer"
                  onClick={() => props.onReact?.(props.message.message_id, group.emoji)}
                  title={group.senders.join(", ")}
                >
                  <span>{group.emoji}</span>
                  <span class="text-[var(--color-text-secondary)]">{group.count}</span>
                </button>
              )}
            </For>
            {/* add reaction — opens the overlay picker */}
            <button
              class="flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-elevated)] transition-colors border border-dashed border-[var(--color-text-tertiary)]/20 hover:border-[var(--color-accent-500)]/30 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] cursor-pointer"
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
