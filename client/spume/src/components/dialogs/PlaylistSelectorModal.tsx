import { createMemo, createSignal, For, Show } from "solid-js";
import { createInfiniteQuery, createQuery, useQueryClient } from "@tanstack/solid-query";
import type { PlaylistSummary } from "../../music/data/types";
import type { Remote } from "../../app/services/storage/schemas/remote";
import type { PlaylistSelectorItem } from "../../music/hooks/playlistSelectorState";
import { canCreatePlaylist } from "../../music/data/permissions";
import { getCurrentRemote } from "../../music/data";
import { localDataSource } from "../../music/data/local/localSource";
import { RemoteMusicDataSource } from "../../music/data/remote/remoteSource";
import { isCharnelMode } from "../../app/services/charnel";
import { getRemoteById, getTauriManagedRemote } from "../../app/services/remotes/remoteManager";
import { initMusicDB } from "../../music/services/storage/db/init";
import { addPlaylistItemsToLocal } from "../../music/services/storage/playlists";
import { importPlaylistItemsToLocal } from "../../music/services/sync/importPlaylistItemsToLocal";
import {
  useCreatePlaylistMutation,
  usePlaylistsQuery,
  useRecentPlaylistsQuery,
} from "../../music/queries/playlists";
import { queryKeys } from "../../music/queries/queryKeys";
import { PlaylistItemDuplicateError } from "../../music/data/types";
import { useAddPlaylistItemsMutation } from "../../video/queries/playlistItems";
import { Button } from "../buttons/Button";
import { Badge } from "../badges/Badge";
import { toast } from "../feedback/Toast";
import { TextInput } from "../forms/TextInput";
import { Icon, IconNames } from "../icons/registry";
import { MediaImage } from "../media/MediaImage";
import { Modal } from "../modals/Modal";

export interface PlaylistSelectorModalProps {
  /** whether the modal is open */
  isOpen: boolean;
  /** callback when modal is closed */
  onClose: () => void;
  /** items to add to the selected playlist — may mix songs and videos. */
  items: PlaylistSelectorItem[];
  /** when set, scope all queries/mutations to this remote rather than
   *  the globally-active data source. */
  remote?: Remote;
}

// playlist selector modal for adding songs and/or videos to playlists
export function PlaylistSelectorModal(props: PlaylistSelectorModalProps) {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [isCreatingNew, setIsCreatingNew] = createSignal(false);
  const [newPlaylistName, setNewPlaylistName] = createSignal("");
  const [importing, setImporting] = createSignal(false);
  const [localError, setLocalError] = createSignal("");

  const queryClient = useQueryClient();

  const recentPlaylistsQuery = useRecentPlaylistsQuery(
    5,
    () => props.isOpen && !searchQuery().trim(),
    () => props.remote,
    true
  );
  const allPlaylistsQuery = usePlaylistsQuery({
    search: () => searchQuery().trim(),
    pageSize: 100,
    remote: () => props.remote,
    ownedOrCollaborativeOnly: () => true,
    enabled: () => props.isOpen && !!searchQuery().trim(),
    keepPreviousData: false,
  });
  const sourceRemote = () => props.remote ?? getCurrentRemote();
  const localLibraryQuery = createQuery(() => ({
    queryKey: ["playlist-selector", "local-library"],
    enabled: props.isOpen && !!sourceRemote(),
    queryFn: async () => {
      if (!isCharnelMode()) return { remote: null };
      const remote = await getTauriManagedRemote();
      if (!remote) throw new Error("local library is unavailable");
      return { remote };
    },
  }));
  const hasSeparateLocalLibrary = () =>
    !!sourceRemote() &&
    !!localLibraryQuery.data &&
    localLibraryQuery.data.remote?.remote_id !== sourceRemote()?.remote_id;
  const localPlaylistsQuery = createInfiniteQuery(() => ({
    queryKey: [
      ...queryKeys.playlists.all(localLibraryQuery.data?.remote?.remote_id ?? "local"),
      "infinite", "selector", searchQuery().trim(),
    ],
    enabled: props.isOpen && hasSeparateLocalLibrary(),
    initialPageParam: 0,
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      const local = localLibraryQuery.data;
      if (!local) throw new Error("local library is unavailable");
      const source = local.remote ? new RemoteMusicDataSource(local.remote) : localDataSource;
      return source.getPlaylists({
        offset: pageParam,
        limit: searchQuery().trim() ? 100 : 5,
        search: searchQuery().trim() || undefined,
        own_or_collaborative_only: true,
      });
    },
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.offset + lastPage.limit : undefined,
  }));

  const addItemsMutation = useAddPlaylistItemsMutation();
  const createPlaylistMutation = useCreatePlaylistMutation();

  const songIds = createMemo(() =>
    props.items.filter((i) => i.entity_type === "song").map((i) => i.entity_id)
  );
  const videoIds = createMemo(() =>
    props.items.filter((i) => i.entity_type === "video").map((i) => i.entity_id)
  );
  const itemCount = () => props.items.length;
  const itemLabel = () => {
    const hasSongs = songIds().length > 0;
    const hasVideos = videoIds().length > 0;
    const count = itemCount();
    if (hasSongs && hasVideos) return count === 1 ? "item" : "items";
    if (hasVideos) return count === 1 ? "video" : "videos";
    return count === 1 ? "song" : "songs";
  };

  // add whichever items this modal instance was opened for to a playlist -
  // songs and videos both go through the shared generic bulk
  // `entities.addPlaylistItems` route in one request (mirrors how reorder
  // was already unified).
  const addItemsToPlaylist = async (playlistId: string) => {
    if (props.items.length === 0) return;
    await addItemsMutation.mutateAsync({
      playlistId,
      items: props.items.map((i) => ({ entity_type: i.entity_type, entity_id: i.entity_id })),
      remote: props.remote,
    });
  };

  // filter playlists based on search query - ownership/collaborative
  // visibility is already applied server-side (see restrictToOwnedOrCollaborative).
  const filteredPlaylists = createMemo(() => {
    if (!searchQuery().trim()) {
      return recentPlaylistsQuery.data || [];
    }
    return allPlaylistsQuery.data?.pages.flatMap((page) => page.items) || [];
  });

  const handleSelectPlaylist = async (playlist: PlaylistSummary) => {
    try {
      await addItemsToPlaylist(playlist.playlist_id);

      props.onClose();
    } catch (error) {
      if (error instanceof PlaylistItemDuplicateError) {
        // already-in-playlist is a soft/expected condition, not a real
        // error - a friendly warning reads better than an error toast.
        toast.warning(`already in "${playlist.title}"`, { title: "already added" });
        props.onClose();
        return;
      }
      console.error(`failed to add ${itemLabel()} to playlist:`, error);
      const errorMessage = error instanceof Error ? error.message : "unknown error";
      toast.error(`failed to add ${itemLabel()}: ${errorMessage}`, {
        title: "error",
      });
    }
  };

  const handleSelectLocalPlaylist = async (playlist: PlaylistSummary) => {
    setImporting(true);
    setLocalError("");
    try {
      const sourceInfo = sourceRemote();
      const selectedItems = props.items.slice();
      const target = localLibraryQuery.data;
      if (!sourceInfo?.remote_id) throw new Error("source remote is unavailable");
      if (!target) throw new Error("local library is unavailable");
      const source = props.remote ?? await getRemoteById(sourceInfo.remote_id);
      if (!source) throw new Error(`source remote not found: ${sourceInfo.remote_id}`);
      const items = await importPlaylistItemsToLocal(selectedItems, source);
      if (target.remote) {
        await addItemsMutation.mutateAsync({ playlistId: playlist.playlist_id, items, remote: target.remote });
      } else {
        const db = await initMusicDB();
        await addPlaylistItemsToLocal(db, playlist.playlist_id, items);
        void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all("local") });
      }
      props.onClose();
    } catch (error) {
      if (error instanceof PlaylistItemDuplicateError) {
        setLocalError(`already in "${playlist.title}"`);
      } else {
        console.error(`failed to add ${itemLabel()} to local playlist:`, error);
        setLocalError(`failed to add ${itemLabel()}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    } finally {
      setImporting(false);
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

      // close modal immediately - don't wait for query invalidation
      props.onClose();

      // invalidate queries in background (fire-and-forget)
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all(props.remote?.remote_id) });
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
    setLocalError("");
    props.onClose();
  };

  const isLoading = () => addItemsMutation.isPending || createPlaylistMutation.isPending || importing();

  const PlaylistRow = (row: { playlist: PlaylistSummary; local: boolean }) => (
    <button
      type="button"
      onClick={() => row.local ? handleSelectLocalPlaylist(row.playlist) : handleSelectPlaylist(row.playlist)}
      disabled={isLoading()}
      class="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-[var(--color-bg-hover)] active:bg-[var(--color-bg-active)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-left"
    >
      <MediaImage
        images={row.playlist.images}
        alt={row.playlist.title}
        domainType="playlist"
        thumbnailSize={50}
        class="w-12 h-12 rounded flex-shrink-0"
      />
      <div class="flex-1 min-w-0">
        <div class="body-sm text-[var(--color-text-primary)] flex items-center gap-2">
          <span class="truncate min-w-0 flex-1">{row.playlist.title}</span>
          <Show when={row.playlist.collaborative}>
            <Badge variant="default" size="sm">collaborative</Badge>
          </Show>
        </div>
        <Show when={row.playlist.song_count > 0}>
          <div class="body-xs text-[var(--color-text-tertiary)]">
            {row.playlist.song_count} {row.playlist.song_count === 1 ? "song" : "songs"}
          </div>
        </Show>
      </div>
      <Icon name={IconNames.add} className="w-4 h-4 text-[var(--color-text-tertiary)] flex-shrink-0" />
    </button>
  );

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={() => { if (!isLoading()) handleClose(); }}
      title={isCreatingNew() ? "create new playlist" : "add to playlist"}
      size="md"
    >
      <div class="flex-1 min-h-0 flex flex-col overflow-hidden p-4 space-y-4">
        <Show
          when={!isCreatingNew()}
          fallback={
            <div class="min-h-0 overflow-y-auto space-y-4">
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
          <div class="flex-shrink-0">
            <TextInput
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              placeholder="search or create new playlist..."
              autofocus
            />
          </div>

          {/* create new button - before playlists list */}
          <Show when={canCreatePlaylist()}>
            <div class="flex-shrink-0 pb-2 border-b border-[var(--color-border-default)]">
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
          <div class="flex-1 min-h-0 overflow-y-auto space-y-1">
            <Show when={hasSeparateLocalLibrary()}>
              <div class="body-xs text-[var(--color-text-tertiary)] px-3 py-2">
                {sourceRemote()?.name}
              </div>
            </Show>
            <Show when={!searchQuery().trim() && !hasSeparateLocalLibrary() && filteredPlaylists().length > 0}>
              <div class="body-xs text-[var(--color-text-tertiary)] px-3 py-2">
                recent playlists
              </div>
            </Show>
            <Show
              when={filteredPlaylists().length > 0}
              fallback={
                <Show
                  when={searchQuery().trim() ? allPlaylistsQuery.isPending : recentPlaylistsQuery.isPending}
                  fallback={
                    <Show when={!(searchQuery().trim() ? allPlaylistsQuery.isError : recentPlaylistsQuery.isError)}>
                      <div class="text-center py-8 text-[var(--color-text-secondary)] body-sm">
                        <Show
                          when={searchQuery().trim()}
                          fallback={
                            <div>
                              <p>{hasSeparateLocalLibrary() ? "no playlists on this remote" : "no playlists yet"}</p>
                              <Show when={!hasSeparateLocalLibrary()}>
                                <p class="mt-2">create one to get started</p>
                              </Show>
                            </div>
                          }
                        >
                          {hasSeparateLocalLibrary() ? "no matching playlists on this remote" : `no playlists found matching "${searchQuery()}"`}
                        </Show>
                      </div>
                    </Show>
                  }
                >
                  <div class="body-sm text-[var(--color-text-secondary)] px-3 py-2">loading playlists...</div>
                </Show>
              }
            >
              <For each={filteredPlaylists()}>
                {(playlist) => <PlaylistRow playlist={playlist} local={false} />}
              </For>
            </Show>
            <Show when={searchQuery().trim() ? allPlaylistsQuery.isError : recentPlaylistsQuery.isError}>
              <div role="alert" class="body-sm text-[var(--color-text-secondary)] px-3 py-2">
                failed to load playlists
              </div>
            </Show>
            <Show when={searchQuery().trim() && allPlaylistsQuery.hasNextPage}>
              <Button variant="ghost" disabled={allPlaylistsQuery.isFetchingNextPage} onClick={() => void allPlaylistsQuery.fetchNextPage()}>
                show more
              </Button>
            </Show>

            <Show when={localLibraryQuery.isError}>
              <div role="alert" class="body-sm text-[var(--color-text-secondary)] px-3 py-2">
                failed to load local library
              </div>
            </Show>
            <Show when={hasSeparateLocalLibrary()}>
              <div class="body-xs text-[var(--color-text-tertiary)] px-3 py-2">local library</div>
              <Show when={localPlaylistsQuery.isError}>
                <div role="alert" class="body-sm text-[var(--color-text-secondary)] px-3 py-2">
                  failed to load local playlists
                </div>
              </Show>
              <For each={localPlaylistsQuery.data?.pages.flatMap((page) => page.items) ?? []}>
                {(playlist) => <PlaylistRow playlist={playlist} local={true} />}
              </For>
              <Show when={!localPlaylistsQuery.isPending && !localPlaylistsQuery.isError && !localPlaylistsQuery.data?.pages.some((page) => page.items.length > 0)}>
                <div class="body-sm text-[var(--color-text-secondary)] px-3 py-2">
                  {searchQuery().trim() ? "no matching local playlists" : "no local playlists yet"}
                </div>
              </Show>
              <Show when={localPlaylistsQuery.hasNextPage}>
                <Button variant="ghost" disabled={localPlaylistsQuery.isFetchingNextPage} onClick={() => void localPlaylistsQuery.fetchNextPage()}>
                  show more
                </Button>
              </Show>
            </Show>
            <Show when={importing()}>
              <div class="body-sm text-[var(--color-text-secondary)] px-3 py-2">adding to local library…</div>
            </Show>
            <Show when={localError()}>
              <div role="alert" class="body-sm text-[var(--color-text-secondary)] px-3 py-2">{localError()}</div>
            </Show>
          </div>
        </Show>
      </div>
    </Modal>
  );
}
