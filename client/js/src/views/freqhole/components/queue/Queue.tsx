import { For, Show, createSignal, createResource, createMemo } from "solid-js";
import { useQueue, storeActions } from "../../store";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { QueueHeader } from "./QueueHeader";
import { QueueItem } from "./QueueItem";
import { createAnalyticsApi } from "../../../../lib/analytics/analytics-api.js";
import { apiClient } from "../../../../lib/api-client.js";
import { useAuth } from "../../../../hooks/auth/index.js";
import { useSongInteractions } from "../../services/songInteractions.js";
import { formatDuration } from "../../../../lib/analytics/analytics-api.js";
import { formatRelativeTime } from "../../../../lib/date-utils.js";
import type { Song } from "../../../../lib/music/schemas/song.js";
import type { UserHistoryResponse } from "../../../../lib/analytics/analytics-api.js";

export function Queue() {
  const [queue] = useQueue();
  const events = useGlobalEvents();
  const [activeTab, setActiveTab] = createSignal<"queue" | "history">("queue");
  const analyticsApi = createAnalyticsApi(() => apiClient);
  const auth = useAuth();
  const songInteractions = useSongInteractions();

  // Listen for queue events
  events.on("queue:add", ({ song }) => {
    storeActions.addToQueue(song);
  });

  events.on("queue:remove", ({ index }) => {
    storeActions.removeFromQueue(index);
  });

  events.on("queue:clear", () => {
    storeActions.clearQueue();
  });

  events.on("queue:replace", ({ songs }) => {
    storeActions.clearQueue();
    songs.forEach((song) => storeActions.addToQueue(song));
  });

  // Listen for favorite updates to queue items
  events.on("queue:update-favorite", ({ songId, isFavorite }) => {
    const queueIndex = queue.items.findIndex((item) => item.id === songId);
    if (queueIndex !== -1) {
      const updatedSong = {
        ...queue.items[queueIndex],
        user_is_favorite: isFavorite,
      };
      storeActions.updateQueueItem(queueIndex, updatedSong);
    }
  });

  events.on("song:play", ({ song, replaceQueue }) => {
    if (replaceQueue) {
      storeActions.clearQueue();
      storeActions.addToQueue(song);
      storeActions.setCurrentIndex(0);
    } else {
      // Add to queue if not already there
      const existingIndex = queue.items.findIndex(
        (item) => item.id === song.id
      );
      if (existingIndex === -1) {
        storeActions.addToQueue(song);
        storeActions.setCurrentIndex(queue.items.length);
      } else {
        storeActions.setCurrentIndex(existingIndex);
      }
    }
    storeActions.playSong(song);
  });

  const handleRemoveFromQueue = (index: number) => {
    events.emit("queue:remove", { index });
  };

  const handleClearQueue = () => {
    events.emit("queue:clear", {});
  };

  // User history resource
  const [userHistoryData] = createResource(
    () => auth.userId,
    async (userId) => {
      if (!userId || !auth.isAuthenticated) return null;
      try {
        return await analyticsApi.getUserHistory(userId, 50, 0);
      } catch (error) {
        console.error("failed to load user history:", error);
        return null;
      }
    }
  );

  // Deduplicate consecutive songs in history
  const deduplicatedHistory = createMemo(() => {
    const history = userHistoryData();
    if (!history?.history) return [];

    const deduplicated = [];
    let lastSongId: string | null = null;

    for (const item of history.history) {
      if (item.song_id && item.song_id !== lastSongId) {
        deduplicated.push(item);
        lastSongId = item.song_id;
      }
    }

    return deduplicated;
  });

  // Convert history item to Song for playback
  const convertHistoryToSong = (
    historyItem: UserHistoryResponse["history"][0]
  ): Song | null => {
    if (!historyItem.song_id) return null;

    return {
      id: historyItem.song_id,
      media_blob_id: historyItem.media_blob_id,
      title: historyItem.title || "unknown title",
      artist: historyItem.artist || "unknown artist",
      album: historyItem.album || null,
      album_artist: historyItem.album_artist || null,
      track_number: historyItem.track_number || null,
      disc_number: historyItem.disc_number || null,
      duration_seconds: historyItem.duration_seconds,
      genre: historyItem.genre || null,
      year: historyItem.year || null,
      bpm: historyItem.bpm || null,
      key_signature: historyItem.key_signature || null,
      thumbnail_blob_id: historyItem.thumbnail_blob_id || null,
      waveform_blob_id: historyItem.waveform_blob_id || null,
      display_title: historyItem.title || "unknown title",
      detailed_display_title: historyItem.title || "unknown title",
      user_is_favorite: false,
      user_rating: null,
      tags: [],
      sub_genres: null,
      thumbnail_blob_ids: [],
      preference_updated_at: null,
      created_at: historyItem.song_created_at || new Date().toISOString(),
    };
  };

  const handleHistorySongPlay = (
    historyItem: UserHistoryResponse["history"][0]
  ) => {
    const song = convertHistoryToSong(historyItem);
    if (song) {
      songInteractions.playSong(song, true);
    }
  };

  const handleHistorySongDoubleClick = (
    historyItem: UserHistoryResponse["history"][0]
  ) => {
    handleHistorySongPlay(historyItem);
  };

  const handleHistorySongContextMenu = (
    e: MouseEvent,
    historyItem: UserHistoryResponse["history"][0]
  ) => {
    e.preventDefault();
    const song = convertHistoryToSong(historyItem);
    if (song) {
      songInteractions.handleRightClick(e, song);
    }
  };

  return (
    <div class="flex flex-col h-full bg-black/80">
      <QueueHeader
        queueLength={queue.items.length}
        onClear={handleClearQueue}
        activeTab={activeTab()}
        onTabChange={setActiveTab}
      />

      <div class="flex-1 overflow-y-auto p-4">
        <Show when={activeTab() === "queue"}>
          <Show
            when={queue.items.length > 0}
            fallback={
              <div class="text-center py-12">
                <div class="w-16 h-16 mx-auto mb-4 bg-gray-800 rounded-full flex items-center justify-center">
                  <svg
                    class="w-8 h-8 text-gray-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                    />
                  </svg>
                </div>
                <p class="text-gray-400 text-sm">queue is empty</p>
                <p class="text-gray-500 text-xs mt-2">
                  add songs to see them here
                </p>
              </div>
            }
          >
            <div class="space-y-1">
              <For each={queue.items}>
                {(song, index) => (
                  <QueueItem
                    song={song}
                    index={index()}
                    isCurrentlyPlaying={index() === queue.currentIndex}
                    onRemove={() => handleRemoveFromQueue(index())}
                  />
                )}
              </For>
            </div>
          </Show>
        </Show>

        <Show when={activeTab() === "history"}>
          <Show
            when={userHistoryData.loading}
            fallback={
              <Show
                when={deduplicatedHistory().length > 0}
                fallback={
                  <div class="text-center py-12">
                    <div class="w-16 h-16 mx-auto mb-4 bg-gray-800 rounded-full flex items-center justify-center">
                      <svg
                        class="w-8 h-8 text-gray-500"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </div>
                    <p class="text-gray-400 text-sm">no listening history</p>
                    <p class="text-gray-500 text-xs mt-2">
                      start playing songs to see your history
                    </p>
                  </div>
                }
              >
                <div class="space-y-1">
                  <For each={deduplicatedHistory()}>
                    {(historyItem) => (
                      <div
                        class="flex items-center py-2 px-3 bg-black hover:bg-magenta-600/20 transition-colors cursor-pointer"
                        onClick={() => handleHistorySongPlay(historyItem)}
                        onDblClick={() =>
                          handleHistorySongDoubleClick(historyItem)
                        }
                        onContextMenu={(e) =>
                          handleHistorySongContextMenu(e, historyItem)
                        }
                      >
                        {/* Thumbnail */}
                        <div class="w-10 h-10 flex-shrink-0 bg-gray-700 mr-3">
                          <Show
                            when={historyItem.thumbnail_blob_id}
                            fallback={
                              <div class="w-full h-full bg-gray-600 flex items-center justify-center">
                                <span class="text-gray-400 text-xs">♪</span>
                              </div>
                            }
                          >
                            <img
                              src={`${apiClient.getBaseUrl()}/api/blobs/${historyItem.thumbnail_blob_id}`}
                              alt=""
                              class="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </Show>
                        </div>

                        {/* Song Info */}
                        <div class="flex-1 min-w-0">
                          <div class="text-white text-sm font-medium truncate">
                            {historyItem.title || "unknown title"}
                          </div>
                          <div class="flex items-center space-x-2 text-xs text-gray-400">
                            <span class="truncate">
                              {historyItem.artist && historyItem.album
                                ? `${historyItem.artist} • ${historyItem.album}`
                                : historyItem.artist ||
                                  historyItem.album ||
                                  "unknown artist"}
                            </span>
                            <Show when={historyItem.duration_seconds}>
                              <span>•</span>
                              <span>
                                {formatDuration(historyItem.duration_seconds!)}
                              </span>
                            </Show>
                          </div>
                        </div>

                        {/* Play Time */}
                        <div class="text-right flex-shrink-0 mr-2">
                          <div class="text-gray-400 text-xs">
                            {formatRelativeTime(historyItem.created_at)}
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            }
          >
            <div class="text-center py-12">
              <div class="w-8 h-8 mx-auto mb-4 border-2 border-gray-600 border-t-magenta-500 rounded-full animate-spin"></div>
              <p class="text-gray-400 text-sm">loading history...</p>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
