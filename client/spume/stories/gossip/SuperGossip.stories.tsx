import { createSignal, Show } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { ChannelSidebar } from "../../src/components/gossip/ChannelSidebar";
import { ChannelThread } from "../../src/components/gossip/ChannelThread";
import { FriendsList } from "../../src/components/gossip/FriendsList";
import { CreateChannelDialog } from "../../src/components/gossip/CreateChannelDialog";
import { JoinChannelDialog } from "../../src/components/gossip/JoinChannelDialog";
import {
  mockChannels,
  mockMembers,
  mockNodeIds,
  mockFriends,
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
    // set to mid-point so there are unread messages after the divider
    initialLastRead[progTopicId] = progMsgs[Math.floor(progMsgs.length / 2)].timestamp;
  }
  const endlessMsgs = mockMessagesByTopic[endlessTopicId] ?? [];
  if (endlessMsgs.length > 0) {
    // set to ~70% so there are a handful of unread messages
    initialLastRead[endlessTopicId] = endlessMsgs[Math.floor(endlessMsgs.length * 0.7)].timestamp;
  }
  const [lastReadByTopic, setLastReadByTopic] =
    createSignal<Record<string, number>>(initialLastRead);

  // dialog state
  const [showCreateDialog, setShowCreateDialog] = createSignal(false);
  const [showJoinDialog, setShowJoinDialog] = createSignal(false);

  // derived
  const activeChannel = () => channels().find((c) => c.topic_id === activeTopicId())!;
  const activeMessages = () => messagesByTopic()[activeTopicId()] ?? [];
  const activeMembers = () => mockMembers[activeTopicId()] ?? [];

  // -- handlers --

  // responsive: on narrow viewports, toggle between sidebar and thread
  const [showSidebar, setShowSidebar] = createSignal(true);

  const handleSelectChannel = (topicId: string) => {
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
  };

  const handleSend = (text: string, attachments: MusicReference[]) => {
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
    // update channel last_message_at
    setChannels((prev) =>
      prev.map((c) => (c.topic_id === activeTopicId() ? { ...c, last_message_at: now() } : c))
    );
  };

  const handleReact = (messageId: string, emoji: string) => {
    setMessagesByTopic((prev) => {
      const msgs = prev[activeTopicId()] ?? [];
      return {
        ...prev,
        [activeTopicId()]: msgs.map((m) => {
          if (m.message_id !== messageId) return m;
          const existing = m.reactions ?? [];
          // toggle: if alice already reacted with this emoji, remove it
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

  const handleCreateChannel = (name: string, description: string) => {
    const topicId = `new-${Date.now().toString(16)}`;
    const ch: GossipChannel = {
      topic_id: topicId,
      name,
      description: description || null,
      creator_node_id: currentNodeId,
      settings: null,
      created_at: now(),
      last_message_at: null,
    };
    setChannels((prev) => [ch, ...prev]);
    setMessagesByTopic((prev) => ({ ...prev, [topicId]: [] }));
    setActiveTopicId(topicId);
    setShowCreateDialog(false);
  };

  const handleJoinChannel = (_inviteData: string) => {
    // stub: pretend we joined "prog cave"
    setShowJoinDialog(false);
  };

  /** load more messages for the endless stream (prepends older messages) */
  const handleLoadMore = () => {
    if (activeTopicId() !== endlessTopicId) return;
    const page = endlessPage();
    const older = generateEndlessMessages(page);
    setMessagesByTopic((prev) => ({
      ...prev,
      [endlessTopicId]: [...older, ...(prev[endlessTopicId] ?? [])],
    }));
    setEndlessPage(page + 1);
  };

  /** save scroll position when switching away, restore when switching to */
  const handleScrollSave = (topicId: string, scrollTop: number) => {
    setScrollPositions((prev) => ({ ...prev, [topicId]: scrollTop }));
  };

  /** mark current channel as fully read (dismiss unread divider) */
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
      {/* narrow: full-width, hidden when viewing thread */}
      {/* wide: fixed 220px, always visible */}
      <div
        class="flex-shrink-0 flex flex-col bg-[var(--color-bg-primary)] w-full wide:w-[220px]"
        classList={{ hidden: !showSidebar(), "wide:flex": !showSidebar() }}
      >
        {/* channel header — keep top-left clear for topnav */}
        <div class="flex-1 overflow-y-auto min-h-[60px]">
          <ChannelSidebar
            channels={channels()}
            activeTopicId={activeTopicId()}
            unreadTopicIds={unread()}
            onSelectChannel={handleSelectChannel}
          />
        </div>

        {/* bottom actions: create + join */}
        <div class="flex items-center gap-2 px-3 py-2">
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

        {/* friends */}
        <div class="flex-1 overflow-y-auto min-h-[54px]">
          <FriendsList friends={mockFriends} currentNodeId={currentNodeId} />
        </div>
      </div>

      {/* main thread */}
      {/* narrow: full-width, hidden when viewing sidebar */}
      {/* wide: flex-1, always visible */}
      <div
        class="flex-1 min-w-0"
        classList={{ hidden: showSidebar(), "wide:block": showSidebar() }}
      >
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
    <div style={{ height: "100vh", width: "100vw" }}>
      <SuperGossipDemo />
    </div>
  ),
};
