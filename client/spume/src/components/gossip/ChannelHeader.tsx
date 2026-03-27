// channel header — name, topic (editable for creator), member avatars, flyout, actions
import { createMemo, createSignal, For, Show } from "solid-js";
import type { GossipChannel, GossipChannelMember } from "../../gossip/gossipTypes";
import { MemberAvatarStack } from "./MemberAvatarStack";
import { Badge } from "../badges/Badge";

export interface ChannelHeaderProps {
  channel: GossipChannel;
  members?: GossipChannelMember[];
  currentNodeId: string;
  resolveAvatar?: (name: string | null) => string | null;
  onBack?: () => void;
  onLeaveChannel?: () => void;
  onDestroyChannel?: () => void;
  onCopyInvite?: () => void;
  copyInviteLabel?: string;
  onAddMember?: () => void;
  friendNodeIds?: Set<string>;
  pendingFriendNodeIds?: Set<string>;
  onlineFriendNodeIds?: Set<string>;
  onAddFriend?: (nodeId: string) => void;
  onUpdateDescription?: (description: string) => void;
}

export function ChannelHeader(props: ChannelHeaderProps) {
  const isCreator = () => props.channel.creator_node_id === props.currentNodeId;
  const isDestroyed = () => !!(props.channel as any).destroyed_at;
  const allowText = () => (props.channel as any).allow_text !== false;
  const [showMembersFlyout, setShowMembersFlyout] = createSignal(false);

  // sorted members: creator first, then alphabetical
  const sortedMembers = createMemo(() => {
    const m = props.members ?? [];
    return [...m].sort((a, b) => {
      if (a.role === "creator") return -1;
      if (b.role === "creator") return 1;
      return (a.display_name ?? "").localeCompare(b.display_name ?? "");
    });
  });

  const shortMembers = () => sortedMembers().slice(0, 3);

  // inline topic editing (creator only)
  const [editingTopic, setEditingTopic] = createSignal(false);
  const [topicDraft, setTopicDraft] = createSignal("");

  const startEditTopic = () => {
    setTopicDraft(props.channel.description ?? "");
    setEditingTopic(true);
  };

  const commitTopic = () => {
    const value = topicDraft().trim();
    if (value !== (props.channel.description ?? "")) {
      props.onUpdateDescription?.(value);
    }
    setEditingTopic(false);
  };

  const cancelEditTopic = () => setEditingTopic(false);

  return (
    <div class="flex items-center gap-3 px-4 py-3 flex-shrink-0">
      <Show when={props.onBack}>
        <button
          class="wide:hidden flex-shrink-0 text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors -ml-1 mr--1 cursor-pointer min-w-[44px] min-h-[44px] flex items-center justify-center"
          onClick={() => props.onBack?.()}
          title="back to channels"
        >
          &larr;
        </button>
      </Show>
      <div class="flex-1 min-w-0">
        <h2 class="text-sm font-semibold text-[var(--color-text-primary)] truncate">
          #{props.channel.name}
          <Show when={isDestroyed()}>
            <span class="ml-1.5 text-[10px] font-normal text-red-400">closed</span>
          </Show>
        </h2>
        <Show
          when={editingTopic()}
          fallback={
            <Show when={props.channel.description || (isCreator() && !isDestroyed())}>
              <p
                class="text-xs text-[var(--color-text-tertiary)] truncate"
                classList={{
                  "cursor-pointer hover:text-[var(--color-text-secondary)]":
                    isCreator() && !isDestroyed() && !!props.onUpdateDescription,
                  "italic opacity-60": !props.channel.description,
                }}
                onClick={() =>
                  isCreator() && !isDestroyed() && props.onUpdateDescription && startEditTopic()
                }
                title={
                  isCreator() && !isDestroyed() && props.onUpdateDescription
                    ? "click to edit topic"
                    : undefined
                }
              >
                {props.channel.description || "set a topic..."}
              </p>
            </Show>
          }
        >
          <input
            ref={(el) => setTimeout(() => el.focus(), 0)}
            class="text-xs text-[var(--color-text-primary)] bg-transparent border-b border-[var(--color-accent-500)] outline-none w-full py-0.5"
            value={topicDraft()}
            onInput={(e) => setTopicDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTopic();
              if (e.key === "Escape") cancelEditTopic();
            }}
            onBlur={commitTopic}
            placeholder="channel topic"
            maxLength={200}
          />
        </Show>
      </div>
      <div class="flex items-center gap-2 flex-shrink-0">
        {/* inline member avatars (wide only) */}
        <Show when={props.members && props.members.length > 0}>
          <button
            class="hidden wide:flex items-center min-h-[44px]"
            onClick={() => setShowMembersFlyout((v) => !v)}
            title="show members"
          >
            <MemberAvatarStack
              members={shortMembers()}
              max={3}
              size="5"
              resolveAvatar={props.resolveAvatar}
              onlineNodeIds={props.onlineFriendNodeIds}
            />
            <Show when={props.members!.length > 3}>
              <div class="w-5 h-5 rounded-full ring-2 ring-[var(--color-bg-primary)] bg-[var(--color-bg-tertiary)] flex items-center justify-center -ml-1.5">
                <span class="text-[8px] text-[var(--color-text-tertiary)]">
                  +{props.members!.length - 3}
                </span>
              </div>
            </Show>
          </button>
        </Show>

        {/* members count button — opens flyout */}
        <div class="relative">
          <button
            class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors cursor-pointer min-h-[44px] flex items-center"
            onClick={() => setShowMembersFlyout((v) => !v)}
            title="show members"
          >
            {props.members?.length ?? 0} {(props.members?.length ?? 0) === 1 ? "member" : "members"}
          </button>

          {/* members flyout */}
          <Show when={showMembersFlyout()}>
            <div class="absolute right-0 top-full mt-1 w-64 bg-[var(--color-bg-elevated)] rounded-lg shadow-xl z-50 overflow-hidden">
              {/* flyout header */}
              <div class="px-3 py-2">
                <span class="text-xs font-medium text-[var(--color-text-secondary)]">
                  members ({props.members?.length ?? 0})
                </span>
              </div>

              {/* member list */}
              <div class="max-h-72 overflow-y-auto py-1">
                <For each={sortedMembers()}>
                  {(member) => (
                    <div class="flex items-center gap-2 px-3 py-1.5 min-h-[44px]">
                      <div class="relative flex-shrink-0">
                        <div class="w-6 h-6 rounded-full overflow-hidden bg-[var(--color-bg-tertiary)]">
                          <Show
                            when={props.resolveAvatar?.(member.display_name)}
                            fallback={
                              <div class="w-full h-full flex items-center justify-center text-[10px] font-semibold text-[var(--color-text-tertiary)]">
                                {(member.display_name ?? "?")[0].toUpperCase()}
                              </div>
                            }
                          >
                            <img
                              src={props.resolveAvatar!(member.display_name)!}
                              alt={member.display_name ?? undefined}
                              class="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </Show>
                        </div>
                        <Show when={props.onlineFriendNodeIds?.has(member.node_id)}>
                          <div class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-[var(--color-bg-elevated)]" />
                        </Show>
                      </div>
                      <span class="text-sm text-[var(--color-text-primary)] truncate flex-1">
                        {member.display_name}
                      </span>
                      <Show when={member.role === "creator"}>
                        <span class="text-[10px] text-[var(--color-accent-500)] flex-shrink-0">
                          creator
                        </span>
                      </Show>
                      <Show
                        when={member.node_id === props.currentNodeId && member.role !== "creator"}
                      >
                        <span class="text-[10px] text-[var(--color-text-tertiary)] flex-shrink-0">
                          you
                        </span>
                      </Show>
                      <Show when={member.node_id !== props.currentNodeId && props.friendNodeIds}>
                        <Show
                          when={props.friendNodeIds!.has(member.node_id)}
                          fallback={
                            <button
                              class="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-accent-500)] transition-colors flex-shrink-0 cursor-pointer"
                              onClick={() => props.onAddFriend?.(member.node_id)}
                            >
                              + add
                            </button>
                          }
                        >
                          <span class="text-[10px] text-[var(--color-text-tertiary)]/60 flex-shrink-0">
                            friend
                          </span>
                        </Show>
                      </Show>
                    </div>
                  )}
                </For>
              </div>

              {/* flyout actions */}
              <div class="px-3 py-2 flex flex-col gap-1">
                <Show when={props.onCopyInvite}>
                  <button
                    class="w-full text-left text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-accent-500)] transition-colors py-0.5 cursor-pointer min-h-[44px] flex items-center"
                    onClick={() => props.onCopyInvite?.()}
                  >
                    {props.copyInviteLabel ?? "copy invite"}
                  </button>
                </Show>
                <Show when={props.onAddMember}>
                  <button
                    class="w-full text-left text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-accent-500)] transition-colors py-0.5 cursor-pointer min-h-[44px] flex items-center"
                    onClick={() => {
                      setShowMembersFlyout(false);
                      props.onAddMember?.();
                    }}
                  >
                    + add member
                  </button>
                </Show>
                <Show when={isCreator() && !isDestroyed() && props.onDestroyChannel}>
                  <button
                    class="w-full text-left text-xs text-red-400 hover:text-red-300 transition-colors py-0.5 cursor-pointer min-h-[44px] flex items-center"
                    onClick={() => {
                      setShowMembersFlyout(false);
                      props.onDestroyChannel?.();
                    }}
                  >
                    destroy channel
                  </button>
                </Show>
                <Show when={!isCreator() && props.onLeaveChannel}>
                  <button
                    class="w-full text-left text-xs text-red-400 hover:text-red-300 transition-colors py-0.5 cursor-pointer min-h-[44px] flex items-center"
                    onClick={() => {
                      setShowMembersFlyout(false);
                      props.onLeaveChannel?.();
                    }}
                  >
                    leave channel
                  </button>
                </Show>
              </div>
            </div>

            {/* click-away backdrop */}
            <div class="fixed inset-0 z-40" onClick={() => setShowMembersFlyout(false)} />
          </Show>
        </div>

        <Badge variant="default" size="sm">
          {allowText() ? "text" : "music only"}
        </Badge>
      </div>
    </div>
  );
}
