// main app entry point with routing
import { HashRouter } from "@solidjs/router";
import { toaster } from "@kobalte/core/toast";
import { useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { EmptyState } from "../components/EmptyState";
import { toast } from "../components/feedback/Toast";
import { ConfigChangedToast } from "../components/feedback/ConfigChangedToast";
import { UpdateAvailableToast } from "../components/feedback/UpdateAvailableToast";
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
  useLocalSource,
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
import { addToQueue } from "../music/services/queue/queue";
import { togglePlayback } from "../music/services/audio/player";
import {
  cleanupCacheNetworkHandlers,
  initCacheNetworkHandlers,
  initCachedAudioURLs,
} from "../music/services/cache/blobCache";
import {
  getAllRemotes,
  upsertTauriRemote,
  checkRemoteHealth,
  findFirstOnlineRemote,
  setActiveRemote,
  getActiveRemote,
} from "./services/remotes/remoteManager";
import { createHttpClient } from "./api/client";
import {
  registerServiceWorker,
  updateAvailable,
  applyServiceWorkerUpdate,
  dismissUpdate,
} from "./services/serviceWorker";
import { initMusicDB } from "../music/services/storage/db";
import type { Song } from "../music/services/storage/types";
import { routes } from "./routes";
import { initAppDB } from "./services/storage/db";
import { debug } from "../utils/logger";
import { isTauriMode } from "../utils/tauri";
import {
  requestFreqholeConfig,
  onConfigUpdated,
  onMessage,
  onAuthRefresh,
  type SpumeMessage,
} from "../utils/tauri/freqhole-bridge";
import { clearRemoteNeedsAuth } from "../music/data/remote/authState";

export function App() {
  const queryClient = useQueryClient();
  const isAddMusicOpen = useAddMusicState();
  const [isAddRemoteOpen, setIsAddRemoteOpen] = createSignal(false);
  const [hasSongs, setHasSongs] = createSignal(false);
  const [hasRemotes, setHasRemotes] = createSignal(false);
  const [isInitializing, setIsInitializing] = createSignal(true);
  const [showLoading, setShowLoading] = createSignal(false);

  // track current hash reactively (allows settings in empty state)
  const [currentHash, setCurrentHash] = createSignal(window.location.hash);
  const isSettingsRoute = () => currentHash().startsWith("#/settings");

  // listen for hash changes to update reactive state
  onMount(() => {
    const handleHashChange = () => setCurrentHash(window.location.hash);
    window.addEventListener("hashchange", handleHashChange);
    onCleanup(() => window.removeEventListener("hashchange", handleHashChange));
  });

  // global keyboard shortcuts
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ignore if user is typing in an input/textarea
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      // spacebar = toggle play/pause
      if (e.code === "Space") {
        e.preventDefault();
        void togglePlayback("ui");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  // handle messages from tauri (config changes, scan completion)
  function handleTauriMessage(msg: SpumeMessage) {
    debug(`tauri message: ${msg.type}`, msg.data);

    switch (msg.type) {
      case "config-changed":
        // show persistent toast with reload button
        toaster.show((props) => (
          <ConfigChangedToast
            toastId={props.toastId}
            message={msg.data.message}
            onReload={() => window.location.reload()}
          />
        ));
        break;

      case "scan-progress":
        // invalidate queries to refresh music data as songs are added
        queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey[0];
            return (
              key === "songs" ||
              key === "albums" ||
              key === "artists" ||
              key === "genres" ||
              key === "feed"
            );
          },
        });
        break;

      case "scan-jobs-complete":
        // final invalidation when scan is complete
        queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey[0];
            return (
              key === "songs" ||
              key === "albums" ||
              key === "artists" ||
              key === "genres" ||
              key === "feed"
            );
          },
        });
        // show toast notification
        toast.success(
          `scan complete: ${msg.data.songs_added} songs, ${msg.data.albums_added} albums, ${msg.data.artists_added} artists added`
        );
        break;

      case "config-updated":
        // handled by onConfigUpdated callback (auto-applies)
        break;
    }
  }

  // auto-setup remote from tauri bridge (for tauri desktop app)
  async function autoSetupRemoteFromTauriBridge() {
    if (!isTauriMode()) {
      debug("not in tauri mode, skipping bridge setup");
      return;
    }

    debug("tauri mode detected, requesting config from bridge...");
    const config = requestFreqholeConfig();

    if (!config) {
      debug("no config from tauri bridge, server may not be ready yet");
      return;
    }

    debug(`got config from tauri bridge: ${config.server_name} @ ${config.server_url}`);

    try {
      // if we have an invite code, use it to authenticate first
      if (config.invite_code) {
        debug("invite code found, authenticating via invite redemption...");
        debug(`using admin_username: ${config.admin_username}`);
        const client = createHttpClient(config.server_url);
        const redeemResult = await client.auth.redeemInvite({
          invite_code: config.invite_code,
          username: config.admin_username ?? null,
        });
        if (redeemResult.success) {
          debug("invite code authentication successful");
          // note: the server sets a session cookie, which will be used for subsequent requests
          // the invite code is one-time use, so we don't need to store it
        } else {
          console.warn("invite code authentication failed:", redeemResult);
          // continue anyway - user may need to re-authenticate via the UI
        }
      }

      // upsert creates or updates the tauri-managed remote (no api_key needed now)
      const remote = await upsertTauriRemote({
        server_id: config.server_id,
        name: config.server_name,
        base_url: config.server_url,
      });
      // use useRemoteSource to properly switch data source AND set active_remote_id
      await useRemoteSource(remote.remote_id, remote.name, remote.base_url);
      debug(`activated tauri remote: ${remote.name} (${remote.base_url})`);

      // subscribe to config updates (server restarts)
      onConfigUpdated(async (newConfig) => {
        debug("tauri: config updated event received, refreshing remote...");
        const updatedRemote = await upsertTauriRemote({
          server_id: newConfig.server_id,
          name: newConfig.server_name,
          base_url: newConfig.server_url,
        });
        await useRemoteSource(updatedRemote.remote_id, updatedRemote.name, updatedRemote.base_url);
        queryClient.invalidateQueries();
        debug(`tauri remote updated: ${updatedRemote.name} (${updatedRemote.base_url})`);
      });

      // subscribe to all tauri messages (config changes, scan progress, etc.)
      onMessage((msg: SpumeMessage) => handleTauriMessage(msg));

      // subscribe to auth refresh events (auto re-auth on 401)
      onAuthRefresh(async ({ invite_code, remote_id }) => {
        debug(`tauri: auth refresh received for ${remote_id}, redeeming invite...`);
        const currentRemote = getCurrentRemote();
        if (!currentRemote) {
          console.warn("no current remote to refresh auth for");
          return;
        }

        const client = createHttpClient(currentRemote.base_url);
        const redeemResult = await client.auth.redeemInvite({
          invite_code,
          username: null,
        });

        if (redeemResult.success) {
          debug("tauri: auth refresh successful");
          clearRemoteNeedsAuth(remote_id);
          // re-fetch data now that we're authenticated
          queryClient.invalidateQueries();
        } else {
          console.warn("tauri: auth refresh failed:", redeemResult);
        }
      });
    } catch (error) {
      console.error("failed to setup tauri remote:", error);
    }
  }

  // request persistent storage (only in prod web mode)
  async function requestPersistentStorage(): Promise<void> {
    if (import.meta.env.DEV || isTauriMode()) {
      return;
    }

    try {
      if ("storage" in navigator && "persist" in navigator.storage) {
        const alreadyPersisted = await navigator.storage.persisted();
        if (alreadyPersisted) {
          debug("persistentStorage", "already granted");
          return;
        }

        const granted = await navigator.storage.persist();
        debug("persistentStorage", granted ? "granted" : "denied");
      }
    } catch (error) {
      console.error("failed to request persistent storage:", error);
    }
  }

  // show update toast when SW update is available
  createEffect(
    on(updateAvailable, (available) => {
      if (available) {
        toaster.show((props) => (
          <UpdateAvailableToast
            toastId={props.toastId}
            onUpgrade={() => {
              toaster.dismiss(props.toastId);
              applyServiceWorkerUpdate();
            }}
            onDismiss={() => {
              toaster.dismiss(props.toastId);
              dismissUpdate();
            }}
          />
        ));
      }
    })
  );

  // initialize databases on mount
  onMount(async () => {
    // show loading indicator after 1 second if still initializing
    const loadingTimer = setTimeout(() => {
      setShowLoading(true);
    }, 1000);

    try {
      await initAppDB();
      await initMusicDB();

      // auto-setup remote from tauri bridge (for desktop app)
      await autoSetupRemoteFromTauriBridge();

      // initialize data source (switches to active remote if configured)
      await initializeDataSource();

      // check health of active remote and auto-switch if offline
      const activeRemote = await getActiveRemote();
      debug("App", "startup health check", {
        hasActiveRemote: !!activeRemote,
        activeRemoteName: activeRemote?.name,
        activeRemoteId: activeRemote?.remote_id,
        isOffline: activeRemote?.is_offline,
      });
      if (activeRemote) {
        debug("App", `checking health of active remote: ${activeRemote.name}`);
        const isOnline = await checkRemoteHealth(activeRemote);
        debug(
          "App",
          `health check result for ${activeRemote.name}: ${isOnline ? "online" : "offline"}`
        );
        if (!isOnline) {
          debug(
            "App",
            `active remote "${activeRemote.name}" is offline, looking for online remote...`
          );
          // try to find another online remote
          const allRemotes = await getAllRemotes();
          const otherRemotes = allRemotes.filter((r) => r.remote_id !== activeRemote.remote_id);
          const onlineRemote = await findFirstOnlineRemote(otherRemotes);
          if (onlineRemote) {
            debug("App", `switching to online remote: ${onlineRemote.name}`);
            await setActiveRemote(onlineRemote.remote_id);
            await useRemoteSource(onlineRemote.remote_id, onlineRemote.name, onlineRemote.base_url);
            toast.warning(`"${activeRemote.name}" is offline, switched to "${onlineRemote.name}"`);
          } else {
            debug("App", "no online remotes found, falling back to local");
            toast.warning(`"${activeRemote.name}" is offline`);
            // actually switch to local if no online remotes found
            await useLocalSource();
          }
        }
      }

      // background health check of ALL remotes (non-blocking)
      // updates offline status in IDB so TopNav shows correct status
      void (async () => {
        const allRemotes = await getAllRemotes();
        if (allRemotes.length > 0) {
          debug("App", `background: checking health of ${allRemotes.length} remotes`);
          await Promise.all(allRemotes.map((r) => checkRemoteHealth(r)));
          debug("App", "background: health check complete");
        }
      })();

      // initialize cache network handlers (online/offline events)
      initCacheNetworkHandlers();

      // seed reactive cache set from existing metadata
      void initCachedAudioURLs();

      // register service worker (prod web mode only)
      void registerServiceWorker();

      // request persistent storage (prod web mode only)
      void requestPersistentStorage();

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

  // callback for when any remote job completes — invalidate queries for new music
  const onRemoteJobComplete = () => {
    setHasSongs(true);
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return (
          key === "songs" ||
          key === "albums" ||
          key === "artists" ||
          key === "genres" ||
          key === "feed" ||
          key === "tags"
        );
      },
    });
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
          queryClient.invalidateQueries({
            predicate: (query) => {
              const key = query.queryKey[0];
              return key === "songs" || key === "albums" || key === "artists";
            },
          });
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
          when={hasSongs() || hasRemotes() || isSettingsRoute()}
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
          debug("App", "remote added successfully:", remote.name);
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
