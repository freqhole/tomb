import { createSignal, For, Show } from "solid-js";
import type { GossipFriend, FriendRequest } from "../../../stories/gossip/mockGossipData";
import { formatRelativeTime } from "../../utils/dateTime";

export interface FriendsListProps {
  friends: GossipFriend[];
  /** pending friend/knock requests */
  friendRequests?: FriendRequest[];
  /** node id of the current user — shown at top with "(you)" label */
  currentNodeId?: string;
  onSelectFriend?: (nodeId: string) => void;
  onAcceptRequest?: (nodeId: string) => void;
  onRejectRequest?: (nodeId: string) => void;
  onAddFriend?: () => void;
}

function lastSeenLabel(friend: GossipFriend): string {
  if (friend.online) return "online";
  if (!friend.last_seen) return "never seen";
  return formatRelativeTime(friend.last_seen * 1000);
}

export function FriendsList(props: FriendsListProps) {
  const [showOffline, setShowOffline] = createSignal(false);
  const isMe = (f: GossipFriend) =>
    props.currentNodeId != null && f.node_id === props.currentNodeId;
  const online = () => {
    const list = props.friends.filter((f) => f.online && !isMe(f));
    const me = props.friends.find((f) => f.online && isMe(f));
    return me ? [me, ...list] : list;
  };
  const offline = () => props.friends.filter((f) => !f.online && !isMe(f));

  return (
    <div class="flex flex-col">
      {/* header */}
      <div class="flex items-center justify-between px-3 py-3 sticky top-0 z-10 bg-[var(--color-bg-primary)]">
        <span class="text-sm font-semibold text-[var(--color-text-primary)]">
          friend<span class="text-[var(--color-accent-500)]">z</span>
        </span>
        <span class="text-[10px] text-[var(--color-text-tertiary)]">{online().length} online</span>
      </div>

      {/* online */}
      <Show when={online().length > 0}>
        <div class="py-0.5">
          <For each={online()}>
            {(friend) => (
              <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--color-bg-secondary)]/50 transition-colors"
                onClick={() => props.onSelectFriend?.(friend.node_id)}
                title={isMe(friend) ? undefined : `see ${friend.display_name}'s messages`}
              >
                <div class="relative flex-shrink-0">
                  <div class="w-6 h-6 rounded-full overflow-hidden bg-[var(--color-bg-tertiary)]">
                    <Show
                      when={friend.avatar_url}
                      fallback={
                        <div class="w-full h-full flex items-center justify-center text-[10px] font-semibold text-[var(--color-text-tertiary)]">
                          {friend.display_name[0].toUpperCase()}
                        </div>
                      }
                    >
                      <img
                        src={friend.avatar_url!}
                        alt={friend.display_name}
                        class="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </Show>
                  </div>
                  <div class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-[var(--color-bg-primary)]" />
                </div>
                <span class="text-sm text-[var(--color-text-primary)] truncate">
                  {friend.display_name}
                </span>
                <Show when={isMe(friend)}>
                  <span class="text-[10px] text-[var(--color-text-tertiary)] ml-auto flex-shrink-0">
                    you
                  </span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* offline — collapsed by default */}
      <Show when={offline().length > 0}>
        <button
          class="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
          onClick={() => setShowOffline((v) => !v)}
        >
          <span class="transition-transform" classList={{ "rotate-90": showOffline() }}>
            &#x25B8;
          </span>
          offline — {offline().length}
        </button>
        <Show when={showOffline()}>
          <div class="py-0.5">
            <For each={offline()}>
              {(friend) => (
                <button
                  class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--color-bg-secondary)]/50 transition-colors"
                  onClick={() => props.onSelectFriend?.(friend.node_id)}
                  title={`see ${friend.display_name}'s messages`}
                >
                  <div class="relative flex-shrink-0">
                    <div class="w-6 h-6 rounded-full overflow-hidden bg-[var(--color-bg-tertiary)]">
                      <Show
                        when={friend.avatar_url}
                        fallback={
                          <div class="w-full h-full flex items-center justify-center text-[10px] font-semibold text-[var(--color-text-tertiary)]">
                            {friend.display_name[0].toUpperCase()}
                          </div>
                        }
                      >
                        <img
                          src={friend.avatar_url!}
                          alt={friend.display_name}
                          class="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </Show>
                    </div>
                    <div class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[var(--color-text-tertiary)]/40 border-2 border-[var(--color-bg-primary)]" />
                  </div>
                  <span class="text-sm text-[var(--color-text-tertiary)] truncate">
                    {friend.display_name}
                  </span>
                  <span class="text-[10px] text-[var(--color-text-tertiary)]/60 ml-auto flex-shrink-0">
                    {lastSeenLabel(friend)}
                  </span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <Show when={props.friends.length === 0}>
        <p class="text-xs text-[var(--color-text-tertiary)] px-3 py-4 text-center">
          no friends yet
        </p>
      </Show>

      {/* friend requests / knocks */}
      <Show when={props.friendRequests && props.friendRequests.length > 0}>
        <div class="px-3 py-1.5">
          <span class="text-[10px] text-[var(--color-accent-500)] font-medium">
            {props.friendRequests!.length}{" "}
            {props.friendRequests!.length === 1 ? "request" : "requests"}
          </span>
        </div>
        <div class="py-0.5">
          <For each={props.friendRequests!}>
            {(req) => (
              <div class="px-3 py-1.5">
                <div class="flex items-center gap-2">
                  <div class="w-6 h-6 rounded-full overflow-hidden flex-shrink-0 bg-[var(--color-bg-tertiary)]">
                    <Show
                      when={req.avatar_url}
                      fallback={
                        <div class="w-full h-full flex items-center justify-center text-[10px] font-semibold text-[var(--color-text-tertiary)]">
                          {req.display_name[0].toUpperCase()}
                        </div>
                      }
                    >
                      <img
                        src={req.avatar_url!}
                        alt={req.display_name}
                        class="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </Show>
                  </div>
                  <span class="text-sm text-[var(--color-text-primary)] truncate flex-1">
                    {req.display_name}
                  </span>
                  <span class="text-[10px] text-[var(--color-text-tertiary)]/60 flex-shrink-0">
                    {formatRelativeTime(req.requested_at * 1000)}
                  </span>
                </div>
                <Show when={req.message}>
                  <p class="text-[11px] text-[var(--color-text-tertiary)] mt-1 ml-8 line-clamp-2">
                    "{req.message}"
                  </p>
                </Show>
                <div class="flex gap-2 ml-8 mt-1.5">
                  <button
                    class="text-[11px] text-[var(--color-accent-500)] hover:text-[var(--color-accent-400)] transition-colors"
                    onClick={() => props.onAcceptRequest?.(req.node_id)}
                  >
                    accept
                  </button>
                  <button
                    class="text-[11px] text-[var(--color-text-tertiary)] hover:text-red-400 transition-colors"
                    onClick={() => props.onRejectRequest?.(req.node_id)}
                  >
                    reject
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* add friend button */}
      <Show when={props.onAddFriend}>
        <div class="px-3 py-2">
          <button
            class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-accent-500)] transition-colors"
            onClick={() => props.onAddFriend?.()}
          >
            + add friend
          </button>
        </div>
      </Show>
    </div>
  );
}
