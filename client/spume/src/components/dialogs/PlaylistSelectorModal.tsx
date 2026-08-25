import { createMemo, createSignal, For, Show } from "solid-js";
import { useQueryClient } from "@tanstack/solid-query";
import type { PlaylistSummary } from "../../music/data/types";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { canCreatePlaylist } from "../../music/data/permissions";
import {
  useAddSongsToPlaylistMutation,
  useCreatePlaylistMutation,
  usePlaylistsQuery,
  useRecentPlaylistsQuery,
} from "../../music/queries/playlists";
import { queryKeys } from "../../music/queries/queryKeys";
import { useAddVideoToPlaylistMutation } from "../../video/queries/playlistItems";
import { Button } from "../buttons/Button";
import { toast } from "../feedback/Toast";
import { TextInput } from "../forms/TextInput";
import { Icon, IconNames } from "../icons/registry";
import { Modal } from "../modals/Modal";

export interface PlaylistSelectorModalProps {
  /** whether the modal is open */
  isOpen: boolean;
  /** callback when modal is closed */
  onClose: () => void;
  /** song IDs to add to the selected playlist */
  songIds: string[];
  /** video IDs to add instead of songIds (mutually exclusive with songIds) */
  videoIds?: string[];
  /** when set, scope all queries/mutations to this remote rather than
   *  the globally-active data source. */
  remote?: Remote;
}

// playlist selector modal for adding songs (or videos) to playlists
export function PlaylistSelectorModal(props: PlaylistSelectorModalProps) {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [isCreatingNew, setIsCreatingNew] = createSignal(false);
  const [newPlaylistName, setNewPlaylistName] = createSignal("");

  const queryClient = useQueryClient();
  const recentPlaylistsQuery = useRecentPlaylistsQuery(
    5,
    () => true,
    () => props.remote
  );
  const allPlaylistsQuery = usePlaylistsQuery({
    search: searchQuery,
    pageSize: 100,
    remote: () => props.remote,
  });

  const addSongsMutation = useAddSongsToPlaylistMutation();
  const addVideoMutation = useAddVideoToPlaylistMutation();
  const createPlaylistMutation = useCreatePlaylistMutation();

  const videoIds = () => props.videoIds ?? [];
  const isVideoMode = () => videoIds().length > 0;
  const itemCount = () => (isVideoMode() ? videoIds().length : props.songIds.length);
  const itemLabel = () => {
    const count = itemCount();
    return isVideoMode() ? (count === 1 ? "video" : "videos") : count === 1 ? "song" : "songs";
  };

  // add whichever kind of item this modal instance was opened for to a
  // playlist - videos go through the domain-generic playlist_itemz
  // route one at a time (no bulk endpoint yet), songs keep the existing
  // bulk addSongsToPlaylist call.
  const addItemsToPlaylist = async (playlistId: string) => {
    if (isVideoMode()) {
      for (const videoId of videoIds()) {
        await addVideoMutation.mutateAsync({ playlistId, videoId });
      }
      return;
    }
    await addSongsMutation.mutateAsync({
      playlistId,
      songIds: props.songIds,
      remote: props.remote,
    });
  };

  // filter playlists based on search query
  const filteredPlaylists = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    if (!query) {
      return recentPlaylistsQuery.data || [];
    }

    // gather all playlists from infinite query pages
    const allPlaylists = allPlaylistsQuery.data?.pages.flatMap((page) => page.items) || [];

    return allPlaylists.filter((playlist) => playlist.title.toLowerCase().includes(query));
  });

  const handleSelectPlaylist = async (playlist: PlaylistSummary) => {
    try {
      await addItemsToPlaylist(playlist.playlist_id);

      toast.success(`added ${itemCount()} ${itemLabel()} to "${playlist.title}"`);

      props.onClose();
    } catch (error) {
      console.error(`failed to add ${itemLabel()} to playlist:`, error);
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      toast.error(`failed to add ${itemLabel()}: ${errorMessage}`, {
        title: "error",
      });
    }
  };

  const handleCreatePlaylist = async () => {
    // use search input value if present, otherwise use new playlist name input, or generate default
    const name = searchQuery().trim() || newPlaylistName().trim() || `new playlist ${Date.now()}`;

    try {
      const newPlaylist = await createPlaylistMutation.mutateAsync({
        title: name,
        description: null,
        remote: props.remote,
      });

      // immediately add the items to the newly created playlist
      await addItemsToPlaylist(newPlaylist.playlist_id);

      toast.success(`created "${name}" and added ${itemCount()} ${itemLabel()}`);

      // close modal immediately - don't wait for query invalidation
      props.onClose();

      // invalidate queries in background (fire-and-forget)
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all() });
    } catch (error) {
      console.error("failed to create playlist:", error);
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      toast.error(`failed to create playlist: ${errorMessage}`, {
        title: "error",
      });
    }
  };

  const handleClose = () => {
    setSearchQuery("");
    setIsCreatingNew(false);
    setNewPlaylistName("");
    props.onClose();
  };

  const isLoading = () =>
    addSongsMutation.isPending || addVideoMutation.isPending || createPlaylistMutation.isPending;

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={handleClose}
      title={isCreatingNew() ? "create new playlist" : "add to playlist"}
      size="md"
    >
      <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        <Show
          when={!isCreatingNew()}
          fallback={
            <div class="space-y-4">
              <TextInput
                value={newPlaylistName()}
                onInput={(e) => setNewPlaylistName(e.currentTarget.value)}
                placeholder="enter playlist name..."
                autofocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreatePlaylist();
                  }
                }}
              />

              <div class="flex gap-3 justify-end">
                <Button
                  variant="ghost"
                  onClick={() => setIsCreatingNew(false)}
                  disabled={isLoading()}
                >
                  cancel
                </Button>
                <Button variant="primary" onClick={handleCreatePlaylist} disabled={isLoading()}>
                  {createPlaylistMutation.isPending ? "creating..." : "create & add"}
                </Button>
              </div>
            </div>
          }
        >
          {/* search input */}
          <TextInput
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            placeholder="search playlists..."
            autofocus
          />

          {/* create new button - before playlists list */}
          <Show when={canCreatePlaylist()}>
            <div class="pb-2 border-b border-[var(--color-border-default)]">
              <Button
                variant="ghost"
                onClick={handleCreatePlaylist}
                disabled={isLoading()}
                class="w-full justify-start"
              >
                <Icon
                  name={IconNames.add}
                  className="w-5 h-5 text-[var(--color-text-tertiary)] flex-shrink-0"
                />
                new playlist
              </Button>
            </div>
          </Show>

          {/* playlists list */}
          <div class="max-h-[400px] overflow-y-auto space-y-1">
            <Show
              when={filteredPlaylists().length > 0}
              fallback={
                <div class="text-center py-8 text-[var(--color-text-secondary)] body-sm">
                  <Show
                    when={searchQuery()}
                    fallback={
                      <div>
                        <p>no playlists yet</p>
                        <p class="mt-2">create one to get started</p>
                      </div>
                    }
                  >
                    no playlists found matching "{searchQuery()}"
                  </Show>
                </div>
              }
            >
              <Show when={!searchQuery()}>
                <div class="body-xs text-[var(--color-text-tertiary)] px-3 py-2">
                  recent playlists
                </div>
              </Show>

              <For each={filteredPlaylists()}>
                {(playlist) => (
                  <button
                    type="button"
                    onClick={() => handleSelectPlaylist(playlist)}
                    disabled={isLoading()}
                    class="
                      w-full
                      flex
                      items-center
                      gap-3
                      px-3
                      py-2
                      rounded
                      hover:bg-[var(--color-bg-hover)]
                      active:bg-[var(--color-bg-active)]
                      disabled:opacity-50
                      disabled:cursor-not-allowed
                      transition-colors
                      text-left
                    "
                  >
                    <Icon
                      name={IconNames.playlist}
                      className="w-5 h-5 text-[var(--color-text-tertiary)] flex-shrink-0"
                    />
                    <div class="flex-1 min-w-0">
                      <div class="body-sm text-[var(--color-text-primary)] truncate">
                        {playlist.title}
                      </div>
                      <Show when={playlist.song_count > 0}>
                        <div class="body-xs text-[var(--color-text-tertiary)]">
                          {playlist.song_count} {playlist.song_count === 1 ? "song" : "songs"}
                        </div>
                      </Show>
                    </div>
                    <Icon
                      name={IconNames.add}
                      className="w-4 h-4 text-[var(--color-text-tertiary)] flex-shrink-0"
                    />
                  </button>
                )}
              </For>
            </Show>
          </div>
        </Show>
      </div>
    </Modal>
  );
}
