// main app entry point with routing
import { HashRouter } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { EmptyState } from "../components/EmptyState";
import { toast } from "../components/feedback/Toast";
import { AddMusicModal } from "../components/modals/AddMusicModal";
import { AddRemoteModal } from "../components/modals/AddRemoteModal";
import { AlbumEditorModal } from "../components/modals/AlbumEditorModal";
import { ArtistEditorModal } from "../components/modals/ArtistEditorModal";
import { SongEditorModal } from "../components/modals/SongEditorModal";
import { ImageCarouselModal } from "../components/modals/ImageCarouselModal";
import { TagSelectorModal } from "../components/modals/TagSelectorModal";
import {
  getDataSource,
  getCurrentRemote,
  initializeDataSource,
  useRemoteSource,
} from "../music/data";
import {
  importMusicFiles,
  getLocalImportProgress,
  clearLocalImportProgress,
  uploadFilesToRemote,
  fetchUrlsOnRemote,
  getUploadJobs,
  clearCompletedJobs,
} from "../music/import";
import {
  hideAlbumEditor,
  hideArtistEditor,
  hideSongEditor,
  hideImageCarousel,
  hideTagSelector,
  showSongEditor,
  useAlbumEditorState,
  useArtistEditorState,
  useSongEditorState,
  useImageCarouselState,
  useTagSelectorState,
  useAddMusicState,
  openAddMusic,
  closeAddMusic,
} from "../music/hooks/modals";
import { queryKeys } from "../music/queries/queryKeys";
import { addToQueue } from "../music/services/queue/queue";
import {
  cleanupCacheNetworkHandlers,
  initCacheNetworkHandlers,
  initCachedAudioURLs,
} from "../music/services/cache/blobCache";
import { getAllRemotes } from "./services/remotes/remoteManager";
import { initMusicDB } from "../music/services/storage/db";
import type { Song } from "../music/services/storage/types";
import { routes } from "./routes";
import { initAppDB } from "./services/storage/db";

export function App() {
  const queryClient = useQueryClient();
  const isAddMusicOpen = useAddMusicState();
  const [isAddRemoteOpen, setIsAddRemoteOpen] = createSignal(false);
  const [hasSongs, setHasSongs] = createSignal(false);
  const [hasRemotes, setHasRemotes] = createSignal(false);
  const [isInitializing, setIsInitializing] = createSignal(true);
  const [showLoading, setShowLoading] = createSignal(false);

  // initialize databases on mount
  onMount(async () => {
    // show loading indicator after 1 second if still initializing
    const loadingTimer = setTimeout(() => {
      setShowLoading(true);
    }, 1000);

    try {
      await initAppDB();
      await initMusicDB();

      // initialize data source (switches to active remote if configured)
      await initializeDataSource();

      // initialize cache network handlers (online/offline events)
      initCacheNetworkHandlers();

      // seed reactive cache set from existing metadata
      void initCachedAudioURLs();

      // check if we have any remotes configured
      const remotes = await getAllRemotes();
      setHasRemotes(remotes.length > 0);

      // check if we have any songs
      const source = getDataSource();
      const result = await source.getSongs({ limit: 1 });
      setHasSongs(result.total > 0);
    } finally {
      clearTimeout(loadingTimer);
      setIsInitializing(false);
      setShowLoading(false);
    }
  });

  // cleanup cache network handlers on unmount
  onCleanup(() => {
    cleanupCacheNetworkHandlers();
  });

  // callback for when any remote job completes — invalidate song queries
  const onRemoteJobComplete = () => {
    setHasSongs(true);
    queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
  };

  const handleFilesSelected = async (files: FileList) => {
    const remote = getCurrentRemote();

    if (remote) {
      // remote upload: fire-and-forget, jobs are tracked reactively
      await uploadFilesToRemote(files, onRemoteJobComplete);
    } else {
      // local import: process files into IndexedDB/OPFS
      // progress is tracked reactively via getLocalImportProgress()
      try {
        const result = await importMusicFiles(files);
        if (result.addedCount > 0) {
          setHasSongs(true);
          queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
          queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
          queryClient.invalidateQueries({ queryKey: queryKeys.artists.all() });
        }
      } catch (error) {
        console.error("failed to process files:", error);
        toast.error("failed to import files", { title: "import error" });
      }
    }
  };

  const handleUrlsSubmitted = async (urls: string[]) => {
    const remote = getCurrentRemote();

    if (!remote) {
      toast.warning("url downloads are only supported with a remote server", {
        title: "not supported",
      });
      return;
    }

    // fire-and-forget, jobs are tracked reactively
    await fetchUrlsOnRemote(urls, onRemoteJobComplete);
  };

  const handleCloseAddMusic = () => {
    clearCompletedJobs();
    clearLocalImportProgress();
    closeAddMusic();
  };

  const handleSongDoubleClick = async (song: Song) => {
    // add song to end of queue and play it
    await addToQueue([song], { startPlaying: true, source: { type: "song", label: song.title } });
  };

  return (
    <>
      <Show
        when={!isInitializing()}
        fallback={
          <Show when={showLoading()}>
            <div class="flex items-center justify-center h-screen bg-[var(--color-bg-primary)]">
              <p class="text-[var(--color-text-secondary)]">loading...</p>
            </div>
          </Show>
        }
      >
        <Show
          when={hasSongs() || hasRemotes()}
          fallback={
            <div class="h-screen flex items-center justify-center bg-[var(--color-bg-primary)]">
              <EmptyState
                onAddMusic={() => openAddMusic()}
                onAddRemote={() => setIsAddRemoteOpen(true)}
              />
            </div>
          }
        >
          <HashRouter>
            {routes({
              onAddMusic: () => openAddMusic(),
              onSongDoubleClick: handleSongDoubleClick,
            })}
          </HashRouter>
        </Show>
      </Show>

      <AddMusicModal
        isOpen={isAddMusicOpen()}
        onClose={handleCloseAddMusic}
        onFilesSelected={handleFilesSelected}
        onUrlsSubmitted={handleUrlsSubmitted}
        remoteName={getCurrentRemote()?.name}
        uploadJobs={getUploadJobs()}
        localImportProgress={getLocalImportProgress()}
      />

      <AddRemoteModal
        isOpen={isAddRemoteOpen()}
        onClose={() => setIsAddRemoteOpen(false)}
        onSuccess={(remote) => {
          console.log("remote added successfully:", remote.name);
          // show success toast
          toast.success(`connected to ${remote.name}`, {
            title: "remote added",
          });
          // activate and switch to the newly added remote
          void (async () => {
            await useRemoteSource(remote.remote_id, remote.name, remote.base_url);
            setHasRemotes(true);
            const source = getDataSource();
            const result = await source.getSongs({ limit: 1 });
            setHasSongs(result.total > 0);
            // navigate to remote songs view
            window.location.hash = `/${remote.remote_id}/songs`;
          })();
        }}
      />

      <Show when={useSongEditorState()()}>
        {(state) => (
          <SongEditorModal
            songId={state().songId}
            onClose={hideSongEditor}
            onSave={() => {
              state().onSave?.();
              hideSongEditor();
            }}
            disableNestedModals={state().disableNestedModals}
          />
        )}
      </Show>

      <Show when={useArtistEditorState()()}>
        {(state) => (
          <ArtistEditorModal
            artistId={state().artistId}
            onClose={hideArtistEditor}
            onSave={() => {
              state().onSave?.();
              hideArtistEditor();
            }}
            disableNestedModals={state().disableNestedModals}
          />
        )}
      </Show>

      <Show when={useAlbumEditorState()()}>
        {(state) => (
          <AlbumEditorModal
            albumId={state().albumId}
            onClose={hideAlbumEditor}
            onSave={() => state().onSave?.()}
            disableNestedModals={state().disableNestedModals}
            onOpenSongEditor={(songId) => showSongEditor({ songId, disableNestedModals: true })}
            onMergeNavigate={state().onMergeNavigate}
          />
        )}
      </Show>

      <Show when={useImageCarouselState()()}>
        {(state) => (
          <ImageCarouselModal
            images={state().images}
            initialIndex={state().initialIndex}
            title={state().title}
            onClose={hideImageCarousel}
          />
        )}
      </Show>

      <Show when={useTagSelectorState()()}>
        {(state) => (
          <TagSelectorModal
            albumIds={state().albumIds}
            albumTitle={state().albumTitle}
            onClose={hideTagSelector}
            onSave={() => {
              state().onSave?.();
              hideTagSelector();
            }}
          />
        )}
      </Show>
    </>
  );
}

export default App;
