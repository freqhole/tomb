import { createSignal, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ChannelSidebar } from "../../src/components/gossip/ChannelSidebar";
import { ChannelThread } from "../../src/components/gossip/ChannelThread";
import { FriendsList } from "../../src/components/gossip/FriendsList";
import { FriendThreadView } from "../../src/components/gossip/FriendThreadView";
import { CreateChannelDialog } from "../../src/components/gossip/CreateChannelDialog";
import { JoinChannelDialog } from "../../src/components/gossip/JoinChannelDialog";
import {
  mockChannels,
  mockMembers,
  mockNodeIds,
  mockFriends,
  mockFriendRequests,
  mockMessagesByTopic,
  mockSongRef,
  mockAlbumRef,
  mockArtistRef,
  mockPlaylistRef,
  mockGenreRef,
  generateEndlessMessages,
  avatarForName,
  type GossipChannel,
  type GossipMessage,
  type GossipFriend,
  type FriendRequest,
  type MusicReference,
} from "./mockGossipData";

const allSearchResults = [mockSongRef, mockAlbumRef, mockArtistRef, mockPlaylistRef, mockGenreRef];

/** generate a unique message id */
let msgCounter = 100;
function nextMsgId() {
  return `msg-${++msgCounter}`;
}

function makePayload(text: string, items: MusicReference[]): string {
  return JSON.stringify({ text: text || null, items });
}

/** the full gossip layout — sidebar + thread + friends */
function SuperGossipDemo() {
  const currentNodeId = mockNodeIds.nancy;
  const now = () => Math.floor(Date.now() / 1000);

  // channels state
  const [channels, setChannels] = createSignal<GossipChannel[]>([...mockChannels]);
  const [activeTopicId, setActiveTopicId] = createSignal(mockChannels[0].topic_id);
  const [unread, setUnread] = createSignal(
    new Set([mockChannels[1].topic_id, mockChannels[3].topic_id])
  );

  // messages state keyed by topic_id
  const [messagesByTopic, setMessagesByTopic] = createSignal<Record<string, GossipMessage[]>>({
    ...mockMessagesByTopic,
  });

  // endless stream page tracking
  const endlessTopicId = mockChannels[3].topic_id;
  const [endlessPage, setEndlessPage] = createSignal(1); // page 0 already loaded

  // scroll position persistence per channel
  const [scrollPositions, setScrollPositions] = createSignal<Record<string, number>>({});

  // last-read timestamps for unread divider
  const progTopicId = mockChannels[1].topic_id;
  const progMsgs = mockMessagesByTopic[progTopicId] ?? [];
  const initialLastRead: Record<string, number> = {};
  if (progMsgs.length > 0) {
    initialLastRead[progTopicId] = progMsgs[Math.floor(progMsgs.length / 2)].timestamp;
  }
  const endlessMsgs = mockMessagesByTopic[endlessTopicId] ?? [];
  if (endlessMsgs.length > 0) {
    initialLastRead[endlessTopicId] = endlessMsgs[Math.floor(endlessMsgs.length * 0.7)].timestamp;
  }
  const [lastReadByTopic, setLastReadByTopic] =
    createSignal<Record<string, number>>(initialLastRead);

  // dialog state
  const [showCreateDialog, setShowCreateDialog] = createSignal(false);
  const [showJoinDialog, setShowJoinDialog] = createSignal(false);

  // friend thread view state
  const [selectedFriend, setSelectedFriend] = createSignal<GossipFriend | null>(null);

  // friends + friend requests state
  const [friends, setFriends] = createSignal<GossipFriend[]>([...mockFriends]);
  const [friendRequests, setFriendRequests] = createSignal<FriendRequest[]>([
    ...mockFriendRequests,
  ]);

  // derived
  const activeChannel = () => channels().find((c) => c.topic_id === activeTopicId())!;
  const activeMessages = () => messagesByTopic()[activeTopicId()] ?? [];
  const activeMembers = () => mockMembers[activeTopicId()] ?? [];
  const channelsByTopic = () => {
    const map: Record<string, GossipChannel> = {};
    for (const ch of channels()) map[ch.topic_id] = ch;
    return map;
  };

  // friend node id sets for quick lookup
  const friendNodeIds = () => new Set(friends().map((f) => f.node_id));
  const pendingFriendNodeIds = () => new Set(friendRequests().map((r) => r.node_id));

  // all messages from a specific friend across all channels
  const friendMessages = () => {
    const f = selectedFriend();
    if (!f) return [];
    const all: GossipMessage[] = [];
    for (const msgs of Object.values(messagesByTopic())) {
      for (const m of msgs) {
        if (m.sender_node_id === f.node_id && !m.deleted_at) all.push(m);
      }
    }
    return all;
  };

  // -- handlers --

  // responsive: on narrow viewports, toggle between sidebar and thread
  const [showSidebar, setShowSidebar] = createSignal(true);

  // simulate gossip network latency on channel switch
  const [loadingChannel, setLoadingChannel] = createSignal(false);
  // simulate latency for loading older message pages
  const [loadingMore, setLoadingMore] = createSignal(false);

  const handleSelectChannel = (topicId: string) => {
    // clear friend thread view if showing
    setSelectedFriend(null);
    // mark current channel as fully read before switching
    const currentMsgs = messagesByTopic()[activeTopicId()] ?? [];
    if (currentMsgs.length > 0) {
      setLastReadByTopic((prev) => ({
        ...prev,
        [activeTopicId()]: currentMsgs[currentMsgs.length - 1].timestamp,
      }));
    }
    setActiveTopicId(topicId);
    // clear unread
    setUnread((prev) => {
      const next = new Set(prev);
      next.delete(topicId);
      return next;
    });
    // on narrow, switch to thread view
    setShowSidebar(false);
    // simulate network latency (1-5s)
    setLoadingChannel(true);
    setTimeout(() => setLoadingChannel(false), 1000 + Math.random() * 4000);
  };

  const handleSelectFriend = (nodeId: string) => {
    const f = friends().find((fr) => fr.node_id === nodeId);
    if (f) {
      setSelectedFriend(f);
      setShowSidebar(false);
    }
  };

  const handleSend = (text: string, attachments: MusicReference[]) => {
    console.log(
      `[story] >>> SEND text="${text}" attachments=${attachments.length} channel=${activeTopicId().slice(0, 8)}`
    );
    const msg: GossipMessage = {
      message_id: nextMsgId(),
      topic_id: activeTopicId(),
      sender_node_id: currentNodeId,
      sender_name: "nancy",
      msg_type: "MusicShare",
      payload: makePayload(text, attachments),
      timestamp: now(),
      received_at: now(),
      deleted_at: null,
      reactions: [],
    };
    setMessagesByTopic((prev) => ({
      ...prev,
      [activeTopicId()]: [...(prev[activeTopicId()] ?? []), msg],
    }));
    setChannels((prev) =>
      prev.map((c) => (c.topic_id === activeTopicId() ? { ...c, last_message_at: now() } : c))
    );
    setLastReadByTopic((prev) => ({ ...prev, [activeTopicId()]: msg.timestamp }));
  };

  const handleReact = (messageId: string, emoji: string) => {
    console.log(
      `[story] >>> REACT msg=${messageId} emoji=${emoji} channel=${activeTopicId().slice(0, 8)}`
    );
    setMessagesByTopic((prev) => {
      const msgs = prev[activeTopicId()] ?? [];
      return {
        ...prev,
        [activeTopicId()]: msgs.map((m) => {
          if (m.message_id !== messageId) return m;
          const existing = m.reactions ?? [];
          const alreadyReacted = existing.some(
            (r) => r.sender_node_id === currentNodeId && r.emoji === emoji
          );
          if (alreadyReacted) {
            return {
              ...m,
              reactions: existing.filter(
                (r) => !(r.sender_node_id === currentNodeId && r.emoji === emoji)
              ),
            };
          }
          return {
            ...m,
            reactions: [
              ...existing,
              {
                message_id: nextMsgId(),
                topic_id: activeTopicId(),
                target_message_id: messageId,
                sender_node_id: currentNodeId,
                sender_name: "nancy",
                emoji,
                timestamp: now(),
              },
            ],
          };
        }),
      };
    });
  };

  const handleDelete = (messageId: string) => {
    console.log(`[story] >>> DELETE msg=${messageId} channel=${activeTopicId().slice(0, 8)}`);
    setMessagesByTopic((prev) => {
      const msgs = prev[activeTopicId()] ?? [];
      return {
        ...prev,
        [activeTopicId()]: msgs.map((m) =>
          m.message_id === messageId ? { ...m, deleted_at: now() } : m
        ),
      };
    });
  };

  const handleCreateChannel = (name: string, description: string, musicOnly: boolean) => {
    const topicId = `new-${Date.now().toString(16)}`;
    const ch: GossipChannel = {
      topic_id: topicId,
      name,
      description: description || null,
      creator_node_id: currentNodeId,
      settings: null,
      allow_text: !musicOnly,
      created_at: now(),
      last_message_at: null,
    };
    setChannels((prev) => [ch, ...prev]);
    setMessagesByTopic((prev) => ({ ...prev, [topicId]: [] }));
    setSelectedFriend(null);
    setActiveTopicId(topicId);
    setShowCreateDialog(false);
    setShowSidebar(false);
  };

  const handleJoinChannel = (_inviteData: string) => {
    setShowJoinDialog(false);
  };

  const handleLeaveChannel = () => {
    const topic = activeTopicId();
    console.log(`[story] >>> LEAVE channel=${topic.slice(0, 8)}`);
    // remove channel from list
    setChannels((prev) => prev.filter((c) => c.topic_id !== topic));
    // switch to first remaining channel
    const remaining = channels();
    if (remaining.length > 0) {
      setActiveTopicId(remaining[0].topic_id);
    }
  };

  const handleDestroyChannel = () => {
    const topic = activeTopicId();
    console.log(`[story] >>> DESTROY channel=${topic.slice(0, 8)}`);
    // remove channel + its messages
    setChannels((prev) => prev.filter((c) => c.topic_id !== topic));
    setMessagesByTopic((prev) => {
      const next = { ...prev };
      delete next[topic];
      return next;
    });
    const remaining = channels();
    if (remaining.length > 0) {
      setActiveTopicId(remaining[0].topic_id);
    }
  };

  const handleAcceptRequest = (nodeId: string) => {
    const req = friendRequests().find((r) => r.node_id === nodeId);
    if (!req) return;
    console.log(`[story] >>> ACCEPT friend request from ${req.display_name}`);
    // move from requests to friends
    setFriendRequests((prev) => prev.filter((r) => r.node_id !== nodeId));
    setFriends((prev) => [
      ...prev,
      {
        node_id: req.node_id,
        display_name: req.display_name,
        avatar_url: req.avatar_url,
        last_seen: now(),
        online: false,
      },
    ]);
  };

  const handleRejectRequest = (nodeId: string) => {
    console.log(`[story] >>> REJECT friend request from ${nodeId.slice(0, 8)}`);
    setFriendRequests((prev) => prev.filter((r) => r.node_id !== nodeId));
  };

  const handleUnfriend = (nodeId: string) => {
    const friend = friends().find((f) => f.node_id === nodeId);
    console.log(`[story] >>> UNFRIEND ${friend?.display_name ?? nodeId.slice(0, 8)}`);
    setFriends((prev) => prev.filter((f) => f.node_id !== nodeId));
    setSelectedFriend(null);
  };

  const handleAddFriend = (nodeId: string) => {
    // check if already a friend or pending
    if (friendNodeIds().has(nodeId) || pendingFriendNodeIds().has(nodeId)) return;
    // find display name from members
    let name = nodeId.slice(0, 8);
    for (const members of Object.values(mockMembers)) {
      const m = members.find((m) => m.node_id === nodeId);
      if (m) {
        name = m.display_name;
        break;
      }
    }
    console.log(`[story] >>> ADD FRIEND ${name}`);
    // add as pending request (simulates sending a request)
    setFriendRequests((prev) => [
      ...prev,
      {
        node_id: nodeId,
        display_name: name,
        avatar_url: null,
        requested_at: now(),
      },
    ]);
    // simulate random acceptance after 1-4 seconds
    const delay = 1000 + Math.random() * 3000;
    setTimeout(() => {
      const roll = Math.random();
      if (roll < 0.6) {
        // accepted!
        console.log(`[story] <<< ${name} accepted your friend request!`);
        handleAcceptRequest(nodeId);
      } else if (roll < 0.85) {
        // rejected
        console.log(`[story] <<< ${name} rejected your friend request`);
        handleRejectRequest(nodeId);
      } else {
        // no response (stays pending)
        console.log(`[story] <<< ${name} hasn't responded yet`);
      }
    }, delay);
  };

  const handleLoadMore = () => {
    if (activeTopicId() !== endlessTopicId) return;
    if (loadingMore()) return; // already fetching
    setLoadingMore(true);
    const page = endlessPage();
    // simulate network latency (1-4s)
    setTimeout(
      () => {
        const older = generateEndlessMessages(page);
        setMessagesByTopic((prev) => ({
          ...prev,
          [endlessTopicId]: [...older, ...(prev[endlessTopicId] ?? [])],
        }));
        setEndlessPage(page + 1);
        setLoadingMore(false);
      },
      1000 + Math.random() * 3000
    );
  };

  const handleScrollSave = (topicId: string, scrollTop: number) => {
    setScrollPositions((prev) => ({ ...prev, [topicId]: scrollTop }));
  };

  const handleDismissUnread = () => {
    const msgs = messagesByTopic()[activeTopicId()] ?? [];
    if (msgs.length > 0) {
      setLastReadByTopic((prev) => ({
        ...prev,
        [activeTopicId()]: msgs[msgs.length - 1].timestamp,
      }));
    }
  };

  return (
    <div class="flex h-full bg-[var(--color-bg-primary)] rounded-lg overflow-hidden">
      {/* left sidebar: channels + friends */}
      <div
        class="flex-shrink-0 flex flex-col bg-[var(--color-bg-primary)] w-full wide:w-[220px]"
        classList={{ hidden: !showSidebar(), "wide:flex": !showSidebar() }}
      >
        {/* channels — shrink-0 so it takes natural height, pushed to top */}
        <div class="flex-shrink-0 overflow-y-auto min-h-[60px] max-h-[50%]">
          <ChannelSidebar
            channels={channels()}
            activeTopicId={selectedFriend() ? undefined : activeTopicId()}
            unreadTopicIds={unread()}
            onSelectChannel={handleSelectChannel}
          />
        </div>

        <div class="flex-shrink-0 flex items-center gap-2 px-3 py-2">
          <button
            class="flex-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-accent-500)] transition-colors text-left"
            onClick={() => setShowCreateDialog(true)}
          >
            new channel
          </button>
          <button
            class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-accent-500)] transition-colors"
            onClick={() => setShowJoinDialog(true)}
          >
            join
          </button>
        </div>

        {/* spacer fills remaining space, pushing friends to bottom */}
        <div class="flex-1 min-h-0" />

        {/* friends — fills available space at bottom */}
        <div class="flex-shrink min-h-[54px] max-h-[60%] flex flex-col overflow-hidden">
          <FriendsList
            friends={friends()}
            friendRequests={friendRequests()}
            currentNodeId={currentNodeId}
            onSelectFriend={handleSelectFriend}
            onAcceptRequest={handleAcceptRequest}
            onRejectRequest={handleRejectRequest}
            onAddFriend={() => console.log("[story] >>> ADD FRIEND")}
          />
        </div>
      </div>

      {/* main content: channel thread or friend thread */}
      <div
        class="flex-1 min-w-0"
        classList={{ hidden: showSidebar(), "wide:block": showSidebar() }}
      >
        <Show
          when={selectedFriend()}
          fallback={
            <Show
              when={activeChannel()}
              fallback={
                <div class="flex items-center justify-center h-full text-sm text-[var(--color-text-tertiary)]">
                  select a channel
                </div>
              }
            >
              <ChannelThread
                channel={activeChannel()}
                messages={activeMessages()}
                members={activeMembers()}
                currentNodeId={currentNodeId}
                loading={loadingChannel()}
                loadingMore={loadingMore()}
                searchResults={allSearchResults}
                onSend={handleSend}
                onReact={handleReact}
                onOpenReactionPicker={(msgId) => handleReact(msgId, "\u{1F525}")}
                onDelete={handleDelete}
                onPlay={(item) => console.log("play", item.title ?? item.name)}
                onFavorite={(item) => console.log("favorite", item.title ?? item.name)}
                onAddToQueue={(item) => console.log("add to queue", item.title ?? item.name)}
                onAddToPlaylist={(item) => console.log("add to playlist", item.title ?? item.name)}
                onSearchMusic={(q) => console.log("search:", q)}
                onLoadMore={activeTopicId() === endlessTopicId ? handleLoadMore : undefined}
                lastReadTimestamp={lastReadByTopic()[activeTopicId()]}
                onDismissUnread={handleDismissUnread}
                resolveAvatar={avatarForName}
                savedScrollTop={scrollPositions()[activeTopicId()]}
                onScrollChange={(pos) => handleScrollSave(activeTopicId(), pos)}
                onBack={() => setShowSidebar(true)}
                onLeaveChannel={handleLeaveChannel}
                onDestroyChannel={handleDestroyChannel}
                onAddMember={() =>
                  console.log("[story] >>> ADD MEMBER to", activeTopicId().slice(0, 8))
                }
                friendNodeIds={friendNodeIds()}
                pendingFriendNodeIds={pendingFriendNodeIds()}
                onAddFriend={handleAddFriend}
              />
            </Show>
          }
        >
          <FriendThreadView
            friend={selectedFriend()!}
            messages={friendMessages()}
            channelsByTopic={channelsByTopic()}
            currentNodeId={currentNodeId}
            onReact={handleReact}
            onOpenReactionPicker={(msgId) => handleReact(msgId, "\u{1F525}")}
            onDelete={handleDelete}
            onPlay={(item) => console.log("play", item.title ?? item.name)}
            onFavorite={(item) => console.log("favorite", item.title ?? item.name)}
            onAddToQueue={(item) => console.log("add to queue", item.title ?? item.name)}
            onAddToPlaylist={(item) => console.log("add to playlist", item.title ?? item.name)}
            resolveAvatar={avatarForName}
            onBack={() => {
              setSelectedFriend(null);
              setShowSidebar(true);
            }}
            onUnfriend={handleUnfriend}
          />
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
        <JoinChannelDialog onJoin={handleJoinChannel} onCancel={() => setShowJoinDialog(false)} />
      </Show>
    </div>
  );
}

// storybook meta — we use a wrapper component, so component is the demo itself
const meta = {
  title: "Gossip/SuperGossip",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<any>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div style={{ height: "100dvh", width: "100vw" }}>
      <SuperGossipDemo />
    </div>
  ),
};
