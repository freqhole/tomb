// gossip view — main gossip page composing sidebar, thread, and dialogs.
// wires gossipStore actions to the storybook-developed components.

import { createEffect, createMemo, createSignal, on, onMount, Show } from "solid-js";
import { ChannelSidebar } from "../../components/gossip/ChannelSidebar";
import { ChannelThread } from "../../components/gossip/ChannelThread";
import { ComposeBar } from "../../components/gossip/ComposeBar";
import { CreateChannelDialog } from "../../components/gossip/CreateChannelDialog";
import { JoinChannelDialog } from "../../components/gossip/JoinChannelDialog";
import { GossipProfileSetup } from "../../components/gossip/GossipProfileSetup";
import { FriendsList } from "../../components/gossip/FriendsList";
import { FriendThreadView } from "../../components/gossip/FriendThreadView";
import * as store from "../gossipStore";
import { warn } from "../../utils/logger";

export function GossipView() {
  const [showSidebar, setShowSidebar] = createSignal(true);
  const [showCreateDialog, setShowCreateDialog] = createSignal(false);
  const [showJoinDialog, setShowJoinDialog] = createSignal(false);
  const [joinError, setJoinError] = createSignal<string | undefined>();
  const [profileSaving, setProfileSaving] = createSignal(false);
  const [profileError, setProfileError] = createSignal<string | undefined>();
  const [copiedNodeId, setCopiedNodeId] = createSignal<string | null>(null);
  const [copiedInvite, setCopiedInvite] = createSignal(false);
  const [selectedFriend, setSelectedFriend] = createSignal<store.GossipFriend | null>(null);

  const currentNodeId = () => store.profile()?.node_id ?? "unknown";
  const needsProfile = () => store.initialized() && !store.profile();

  onMount(() => {
    store.init();
  });

  // auto-select first channel when channels load and none is active
  createEffect(
    on(
      () => store.channels(),
      (chs) => {
        if (chs.length && !store.activeTopicId()) {
          store.selectChannel(chs[0].topic_id);
        }
      }
    )
  );

  // ---- channel actions ----

  const handleSelectChannel = (topicId: string) => {
    setSelectedFriend(null);
    store.selectChannel(topicId);
  };

  const handleCreateChannel = async (name: string, description: string, musicOnly: boolean) => {
    try {
      const ch = await store.createChannel(name, description || null, musicOnly);
      setShowCreateDialog(false);
      store.selectChannel(ch.topic_id);
    } catch (e) {
      warn("gossip-view", "create channel failed:", e);
    }
  };

  const handleJoinChannel = async (inviteData: string) => {
    try {
      // invite data is JSON: { topic_id, channel_name, creator_node_id }
      const parsed = JSON.parse(inviteData);
      const ch = await store.joinChannel(
        parsed.topic_id,
        parsed.channel_name,
        parsed.creator_node_id
      );
      setShowJoinDialog(false);
      setJoinError(undefined);
      store.selectChannel(ch.topic_id);
    } catch (e: any) {
      setJoinError(e?.message ?? "failed to join channel");
      warn("gossip-view", "join failed:", e);
    }
  };

  const handleLeaveChannel = async () => {
    const tid = store.activeTopicId();
    if (!tid) return;
    await store.leaveChannel(tid);
    setShowSidebar(true);
  };

  // ---- message actions ----

  const handleSend = (text: string, attachments: any[]) => {
    store.sendMessage(text || null, attachments);
  };

  const handleReact = (messageId: string, emoji: string) => {
    store.react(messageId, emoji);
  };

  const handleDelete = (messageId: string) => {
    store.deleteMessage(messageId);
  };

  const handleLoadMore = () => {
    // all messages loaded from IndexedDB at once for now.
    // midden transport will deliver new messages in real-time.
  };

  const handleProfileSubmit = async (displayName: string) => {
    setProfileSaving(true);
    setProfileError(undefined);
    try {
      await store.saveProfile(displayName, null);
    } catch (e: any) {
      setProfileError(e?.message ?? "failed to save profile");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleCopyNodeId = async (nodeId: string) => {
    if (!nodeId || nodeId === "unknown") return;
    await navigator.clipboard.writeText(nodeId);
    setCopiedNodeId(nodeId);
    setTimeout(() => setCopiedNodeId(null), 2000);
  };

  const handleCopyInvite = async () => {
    const tid = store.activeTopicId();
    if (!tid) return;
    try {
      const invite = await store.getInvite(tid);
      await navigator.clipboard.writeText(JSON.stringify(invite));
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2000);
    } catch (e) {
      warn("gossip-view", "copy invite failed:", e);
    }
  };

  const friendNodeIds = () => new Set(store.friends().map((f) => f.node_id));

  const handleAddFriend = (nodeId: string) => {
    // find display name from current channel members
    const member = store.activeMembers().find((m: any) => m.node_id === nodeId);
    store.addFriend(nodeId, member?.display_name ?? undefined);
  };

  const handleSelectFriend = (nodeId: string) => {
    const f = store.friends().find((fr) => fr.node_id === nodeId);
    if (f) setSelectedFriend(f);
  };

  const handleUnfriend = (nodeId: string) => {
    store.removeFriend(nodeId);
    if (selectedFriend()?.node_id === nodeId) setSelectedFriend(null);
  };

  // all messages from the selected friend across all loaded channels
  const friendMessages = createMemo(() => {
    const f = selectedFriend();
    if (!f) return [];
    const all: any[] = [];
    for (const ch of store.channels()) {
      const msgs = store.messagesByTopicRaw()[ch.topic_id] ?? [];
      for (const m of msgs) {
        if (m.sender_node_id === f.node_id && !m.deleted_at) all.push(m);
      }
    }
    return all.sort((a, b) => a.timestamp - b.timestamp);
  });

  const channelsByTopic = createMemo(() => {
    const map: Record<string, any> = {};
    for (const ch of store.channels()) map[ch.topic_id] = ch;
    return map;
  });

  // ---- render ----

  return (
    <div class="flex h-full overflow-hidden">
      {/* sidebar */}
      <div
        class="flex-shrink-0 flex flex-col pt-[60px]"
        classList={{
          "w-64": showSidebar(),
          "w-0 overflow-hidden": !showSidebar(),
          "absolute inset-y-0 left-0 z-30 w-64 bg-[var(--color-bg-primary)]": !showSidebar(),
        }}
        style={{ display: showSidebar() ? undefined : "none" }}
      >
        <div class="flex-1 min-h-0 overflow-y-auto">
          <ChannelSidebar
            channels={store.channels() as any}
            activeTopicId={store.activeTopicId() ?? undefined}
            unreadTopicIds={store.unread()}
            onSelectChannel={handleSelectChannel}
          />
        </div>

        <div class="flex-shrink-0 flex items-center gap-2 px-3 py-2">
          <button
            class="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            onClick={() => setShowCreateDialog(true)}
          >
            new channel
          </button>
          <button
            class="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            onClick={() => setShowJoinDialog(true)}
          >
            join
          </button>
        </div>

        {/* spacer pushes friends to bottom */}
        <div class="flex-1 min-h-0" />

        {/* friends list at bottom */}
        <div class="flex-shrink min-h-[54px] max-h-[40%] flex flex-col overflow-hidden">
          <FriendsList
            friends={store.friends() as any}
            currentNodeId={currentNodeId()}
            currentDisplayName={store.profile()?.display_name}
            onCopyNodeId={handleCopyNodeId}
            copiedNodeId={copiedNodeId()}
            onSelectFriend={handleSelectFriend}
          />
        </div>
      </div>

      {/* main content */}
      <div class="flex-1 min-w-0 flex flex-col">
        <Show
          when={selectedFriend()}
          fallback={
            <Show
              when={store.activeChannel()}
              fallback={
                <div class="flex-1 flex items-center justify-center text-[var(--color-text-tertiary)]">
                  <Show
                    when={store.channels().length}
                    fallback={
                      <div class="text-center">
                        <p class="text-sm mb-2">no channels yet</p>
                        <button
                          class="text-xs text-[var(--color-accent)] hover:underline"
                          onClick={() => setShowCreateDialog(true)}
                        >
                          create one
                        </button>
                      </div>
                    }
                  >
                    <p class="text-sm">select a channel</p>
                  </Show>
                </div>
              }
            >
              {(channel) => (
                <>
                  <ChannelThread
                    channel={channel() as any}
                    messages={store.activeMessages() as any}
                    members={store.activeMembers() as any}
                    currentNodeId={currentNodeId()}
                    loading={store.loadingChannel()}
                    loadingMore={false}
                    onReact={handleReact}
                    onDelete={handleDelete}
                    onLoadMore={handleLoadMore}
                    onLeaveChannel={handleLeaveChannel}
                    onCopyInvite={handleCopyInvite}
                    copyInviteLabel={copiedInvite() ? "copied!" : "copy invite"}
                    friendNodeIds={friendNodeIds()}
                    onAddFriend={handleAddFriend}
                    onBack={() => setShowSidebar(true)}
                  />
                  {/* connection status bar */}
                  <Show when={store.initialized()}>
                    <div class="flex items-center gap-3 px-4 py-1.5 text-[10px] text-[var(--color-text-tertiary)] flex-shrink-0">
                      {/* node status */}
                      <div class="flex items-center gap-1.5">
                        <div
                          class="w-1.5 h-1.5 rounded-full"
                          classList={{
                            "bg-green-500": store.nodeStatus().status === "online",
                            "bg-yellow-500 animate-pulse": store.nodeStatus().status === "connecting",
                            "bg-red-500": store.nodeStatus().status === "error",
                            "bg-[var(--color-text-tertiary)]/30": store.nodeStatus().status === "idle",
                          }}
                        />
                        <span>
                          {store.nodeStatus().status === "online"
                            ? "p2p online"
                            : store.nodeStatus().status === "connecting"
                              ? "connecting..."
                              : store.nodeStatus().status === "error"
                                ? `error: ${store.nodeStatus().error?.slice(0, 50)}`
                                : "p2p idle"}
                        </span>
                      </div>

                      {/* topic status */}
                      <Show when={store.activeTopicId()}>
                        <span class="text-[var(--color-text-tertiary)]/40">|</span>
                        <div class="flex items-center gap-1.5">
                          <span>
                            {store.activeTopicStatus() === "connected"
                              ? `${store.activeTopicPeerCount()} ${store.activeTopicPeerCount() === 1 ? "peer" : "peers"}`
                              : store.activeTopicStatus() === "waiting_for_peers"
                                ? "waiting for peers..."
                                : store.activeTopicStatus() === "subscribing"
                                  ? "subscribing..."
                                  : store.activeTopicStatus() === "error"
                                    ? "topic error"
                                    : "not subscribed"}
                          </span>
                        </div>
                        <span class="text-[var(--color-text-tertiary)]/40">|</span>
                        <span>{store.subscribedTopicCount()} topics active</span>
                      </Show>
                    </div>
                  </Show>
                  <ComposeBar
                    onSend={(text, attachments) => handleSend(text, attachments)}
                    placeholder={
                      channel().music_only
                        ? `share music in ${channel().name}...`
                        : `share in ${channel().name}...`
                    }
                    allowText={!channel().music_only}
                  />
                </>
              )}
            </Show>
          }
        >
          {(friend) => (
            <FriendThreadView
              friend={friend() as any}
              messages={friendMessages() as any}
              channelsByTopic={channelsByTopic()}
              currentNodeId={currentNodeId()}
              onReact={handleReact}
              onDelete={handleDelete}
              onUnfriend={handleUnfriend}
              onBack={() => {
                setSelectedFriend(null);
                setShowSidebar(true);
              }}
            />
          )}
        </Show>
      </div>

      {/* dialogs */}
      <Show when={showCreateDialog()}>
        <CreateChannelDialog
          onSubmit={handleCreateChannel}
          onCancel={() => setShowCreateDialog(false)}
        />
      </Show>
      <Show when={showJoinDialog()}>
        <JoinChannelDialog
          onJoin={handleJoinChannel}
          onCancel={() => {
            setShowJoinDialog(false);
            setJoinError(undefined);
          }}
          error={joinError()}
        />
      </Show>
      <Show when={needsProfile()}>
        <GossipProfileSetup
          onSubmit={handleProfileSubmit}
          saving={profileSaving()}
          error={profileError()}
        />
      </Show>
    </div>
  );
}
