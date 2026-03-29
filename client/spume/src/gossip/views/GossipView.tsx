// gossip view — main gossip page composing sidebar, thread, and dialogs.
// wires gossipStore actions to the storybook-developed components.

import { createEffect, createMemo, createSignal, on, onMount, Show } from "solid-js";
import { ChannelSidebar } from "../../components/gossip/ChannelSidebar";
import { ChannelHeader } from "../../components/gossip/ChannelHeader";
import { ChannelThread } from "../../components/gossip/ChannelThread";
import { ComposeBar } from "../../components/gossip/ComposeBar";
import { CreateChannelDialog } from "../../components/gossip/CreateChannelDialog";
import { JoinChannelDialog } from "../../components/gossip/JoinChannelDialog";
import { GossipProfileSetup } from "../../components/gossip/GossipProfileSetup";
import { FriendsList } from "../../components/gossip/FriendsList";
import { FriendThreadView } from "../../components/gossip/FriendThreadView";
import { AddFriendDialog } from "../../components/gossip/AddFriendDialog";
import { InviteQrModal } from "../../components/gossip/InviteQrModal";
import * as store from "../store";
import { warn } from "../../utils/logger";
import { getDataSource, RemoteMusicDataSource } from "../../music/data";
import { getAllRemotes } from "../../app/services/remotes/remoteManager";
import { toRemoteRef } from "../../app/services/storage/schemas/remote";
import type { Remote } from "../../app/services/storage/schemas/remote";
import type { MusicDataSource } from "../../music/data/types";
import { parseInviteInput, inviteToUrl } from "../gossipInvite";
import type { MusicReference } from "../../gossip/gossipTypes";

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
  const [showAddFriendDialog, setShowAddFriendDialog] = createSignal(false);
  const [pendingInvite, setPendingInvite] = createSignal<string | undefined>();
  const [inviteQrUrl, setInviteQrUrl] = createSignal<string | undefined>();
  const [musicSearchResults, setMusicSearchResults] = createSignal<MusicReference[]>([]);
  const [remotes, setRemotes] = createSignal<Remote[]>([]);
  const [selectedRemoteId, setSelectedRemoteId] = createSignal<string | null>(null);

  const currentNodeId = () => store.profile()?.node_id ?? "unknown";
  const needsProfile = () => store.initialized() && !store.profile();

  // read receipts — derived from member data (last_read_message_id)
  const readReceipts = createMemo(() =>
    store.readReceiptsForTopic(store.activeTopicId(), currentNodeId())
  );

  onMount(() => {
    store.init();

    // load available remotes for music search source picker
    // default to tauri-managed remote (charnel) or first available remote
    getAllRemotes().then((all) => {
      setRemotes(all);
      const charnel = all.find((r) => r.is_charnel_managed);
      if (charnel) {
        setSelectedRemoteId(charnel.remote_id);
      } else if (all.length) {
        setSelectedRemoteId(all[0].remote_id);
      }
    });

    // detect ?g= invite param in URL
    const params = new URLSearchParams(window.location.search);
    const gParam = params.get("g");
    if (gParam) {
      try {
        const invite = parseInviteInput(gParam);
        setPendingInvite(JSON.stringify(invite));
        setShowJoinDialog(true);
      } catch {
        warn("gossip-view", "invalid ?g= invite param");
      }
      // clear ?g= from URL without reload
      params.delete("g");
      const qs = params.toString();
      const newUrl = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
      window.history.replaceState(null, "", newUrl);
    }
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

  let searchDebounce: ReturnType<typeof setTimeout> | null = null;

  // resolve the data source for music search based on selected remote
  const getSearchDataSource = (): MusicDataSource => {
    const rid = selectedRemoteId();
    if (rid) {
      const remote = remotes().find((r) => r.remote_id === rid);
      if (remote) return new RemoteMusicDataSource(toRemoteRef(remote));
    }
    return getDataSource();
  };

  const handleSearchMusic = (query: string) => {
    if (searchDebounce) clearTimeout(searchDebounce);
    if (!query || query.length < 2) {
      setMusicSearchResults([]);
      return;
    }
    searchDebounce = setTimeout(async () => {
      try {
        const ds = getSearchDataSource();
        if (!ds.search) {
          setMusicSearchResults([]);
          return;
        }
        const resp = await ds.search({ query, field: "all", page: 1, page_size: 10 });
        const nodeId = store.profile()?.node_id ?? "local";
        const sourceName =
          remotes().find((r) => r.remote_id === selectedRemoteId())?.name ?? "unknown";
        const results: MusicReference[] = [];
        for (const s of resp.songs ?? []) {
          results.push({
            ref_type: "Song",
            remote_id: s.id,
            source_node_id: nodeId,
            source_name: sourceName,
            title: s.title,
            track_artist: s.artist_names.join(", ") || null,
            album_title: s.album_title,
            duration: s.duration,
            track_number: 1,
            disc_number: 1,
            bpm: null,
            thumbnail_url: s.thumbnail_url ?? undefined,
            thumbnails: s.thumbnail_url ? [s.thumbnail_url] : [],
          });
        }
        for (const a of resp.albums ?? []) {
          results.push({
            ref_type: "Album",
            remote_id: a.id,
            source_node_id: nodeId,
            source_name: sourceName,
            title: a.title,
            artist_name: a.artist_names.join(", ") || null,
            genres: a.genres,
            thumbnail_url: a.thumbnail_url ?? undefined,
            thumbnails: a.thumbnail_url ? [a.thumbnail_url] : [],
          });
        }
        for (const a of resp.artists ?? []) {
          results.push({
            ref_type: "Artist",
            remote_id: a.id,
            source_node_id: nodeId,
            source_name: sourceName,
            name: a.name,
            thumbnails: [],
          });
        }
        setMusicSearchResults(results);
      } catch (e) {
        warn("gossip-view", "music search failed:", e);
        setMusicSearchResults([]);
      }
    }, 300);
  };

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
      const parsed = parseInviteInput(inviteData);
      const ch = await store.joinChannel(
        parsed.topic_id,
        parsed.channel_name,
        parsed.creator_node_id,
        parsed.music_only
      );
      setShowJoinDialog(false);
      setJoinError(undefined);
      setPendingInvite(undefined);
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

  const handleDestroyChannel = async () => {
    const tid = store.activeTopicId();
    if (!tid) return;
    await store.destroyChannel(tid);
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
      const url = inviteToUrl(invite);
      await navigator.clipboard.writeText(url);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2000);
    } catch (e) {
      warn("gossip-view", "copy invite failed:", e);
    }
  };

  const handleShowInviteQr = async () => {
    const tid = store.activeTopicId();
    if (!tid) return;
    try {
      const invite = await store.getInvite(tid);
      setInviteQrUrl(inviteToUrl(invite));
    } catch (e) {
      warn("gossip-view", "show invite QR failed:", e);
    }
  };

  const friendNodeIds = () => new Set(store.friends().map((f) => f.node_id));
  const onlineFriendNodeIds = () =>
    new Set(
      store
        .friends()
        .filter((f) => f.online)
        .map((f) => f.node_id)
    );

  const handleAddFriend = (nodeId: string) => {
    // find display name from current channel members
    const member = store.activeMembers().find((m: any) => m.node_id === nodeId);
    store.addFriend(nodeId, member?.display_name ?? undefined);
  };

  const handleUpdateDescription = (description: string) => {
    const tid = store.activeTopicId();
    if (tid) store.updateChannelDescription(tid, description);
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
        <div class="flex-shrink-0 overflow-y-auto min-h-[60px] max-h-[50%]">
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
        <div class="flex-shrink min-h-[54px] max-h-[60%] flex flex-col overflow-hidden">
          <FriendsList
            friends={store.friends() as any}
            currentNodeId={currentNodeId()}
            currentDisplayName={store.profile()?.display_name}
            onCopyNodeId={handleCopyNodeId}
            copiedNodeId={copiedNodeId()}
            onSelectFriend={handleSelectFriend}
            onAddFriend={() => setShowAddFriendDialog(true)}
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
                  <ChannelHeader
                    channel={channel() as any}
                    members={store.activeMembers() as any}
                    currentNodeId={currentNodeId()}
                    resolveAvatar={undefined}
                    onBack={() => setShowSidebar(true)}
                    onLeaveChannel={handleLeaveChannel}
                    onDestroyChannel={handleDestroyChannel}
                    onCopyInvite={handleCopyInvite}
                    copyInviteLabel={copiedInvite() ? "copied!" : "copy invite"}
                    onShowQr={handleShowInviteQr}
                    friendNodeIds={friendNodeIds()}
                    onlineFriendNodeIds={onlineFriendNodeIds()}
                    onAddFriend={handleAddFriend}
                    onUpdateDescription={handleUpdateDescription}
                  />
                  <ChannelThread
                    channel={channel() as any}
                    messages={store.activeMessages() as any}
                    currentNodeId={currentNodeId()}
                    loading={store.loadingChannel()}
                    loadingMore={false}
                    onReact={handleReact}
                    onDelete={handleDelete}
                    onLoadMore={handleLoadMore}
                    friendNodeIds={friendNodeIds()}
                    onAddFriend={handleAddFriend}
                    readReceipts={readReceipts()}
                    otherMemberCount={Math.max(0, (store.activeMembers()?.length ?? 0) - 1)}
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
                            "bg-yellow-500 animate-pulse":
                              store.nodeStatus().status === "connecting",
                            "bg-red-500": store.nodeStatus().status === "error",
                            "bg-[var(--color-text-tertiary)]/30":
                              store.nodeStatus().status === "idle",
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
                  <Show
                    when={!channel().destroyed_at}
                    fallback={
                      <div class="flex items-center gap-3 px-4 py-3 bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] text-sm flex-shrink-0">
                        <span class="flex-1">
                          this channel was closed by the creator. you can still read the history.
                        </span>
                        <button
                          class="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                          onClick={handleLeaveChannel}
                        >
                          leave &amp; delete
                        </button>
                      </div>
                    }
                  >
                    <ComposeBar
                      onSend={(text, attachments) => handleSend(text, attachments)}
                      onSearchMusic={handleSearchMusic}
                      searchResults={musicSearchResults()}
                      placeholder={
                        channel().music_only
                          ? `share music in ${channel().name}...`
                          : `share in ${channel().name}...`
                      }
                      allowText={!channel().music_only}
                    />
                  </Show>
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
            setPendingInvite(undefined);
          }}
          error={joinError()}
          initialInvite={pendingInvite()}
        />
      </Show>
      <Show when={needsProfile()}>
        <GossipProfileSetup
          onSubmit={handleProfileSubmit}
          saving={profileSaving()}
          error={profileError()}
        />
      </Show>
      <Show when={showAddFriendDialog()}>
        <AddFriendDialog
          currentNodeId={currentNodeId()}
          onAdd={(nodeId, displayName) => {
            store.addFriend(nodeId, displayName);
            setShowAddFriendDialog(false);
          }}
          onCancel={() => setShowAddFriendDialog(false)}
        />
      </Show>
      <Show when={inviteQrUrl()}>
        <InviteQrModal
          url={inviteQrUrl()!}
          channelName={store.activeChannel()?.name ?? "channel"}
          onClose={() => setInviteQrUrl(undefined)}
        />
      </Show>
    </div>
  );
}
