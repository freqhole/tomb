// main app entry point with routing
import { HashRouter } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { EmptyState } from "../components/EmptyState";
import { ConfigChangedToast } from "../components/feedback/ConfigChangedToast";
import { toast } from "../components/feedback/Toast";
import { UpdateAvailableToast } from "../components/feedback/UpdateAvailableToast";
import { AddMusicModal } from "../components/modals/AddMusicModal";
import { AddRemoteModal } from "../components/modals/AddRemoteModal";
import { AlbumEditorModal } from "../components/modals/AlbumEditorModal";
import { ArtistEditorModal } from "../components/modals/ArtistEditorModal";
import { ImageCarouselModal } from "../components/modals/ImageCarouselModal";
import { ResolveShareModal } from "../components/modals/ResolveShareModal";
import { ShareModal } from "../components/modals/ShareModal";
import { SongEditorModal } from "../components/modals/SongEditorModal";
import { TagSelectorModal } from "../components/modals/TagSelectorModal";
import { QueueFullModal } from "../music/components/QueueFullModal";
import {
  getCurrentRemote,
  getDataSource,
  getRemoteClient,
  useLocalSource,
  useRemoteSource,
} from "../music/data";
import {
  closeAddMusic,
  hideAlbumEditor,
  hideArtistEditor,
  hideImageCarousel,
  hideSongEditor,
  hideTagSelector,
  hideShareModal,
  openAddMusic,
  showSongEditor,
  useAddMusicState,
  useAlbumEditorState,
  useArtistEditorState,
  useImageCarouselState,
  useShareModalState,
  useSongEditorState,
  useTagSelectorState,
} from "../music/hooks/modals";
import {
  clearCompletedJobs,
  clearLocalImportProgress,
  fetchUrlsOnRemote,
  getLocalImportProgress,
  getUploadJobs,
  importMusicFiles,
  uploadFilesToRemote,
  uploadPathsToRemote,
} from "../music/import";
import { togglePlayback } from "../music/services/audio/player";
import {
  cleanupCacheNetworkHandlers,
  initCachedAudioURLs,
  initCacheNetworkHandlers,
} from "../music/services/cache/blobCache";
import { initDownloadState } from "../music/services/download";
import { addToQueue } from "../music/services/queue/queue";
import { initMusicDB } from "../music/services/storage/db";
import type { Song } from "../music/services/storage/types";
import { debug } from "../utils/logger";
import { extractShareTokenFromHash, SHARE_HASH_PARAM } from "../utils/permalink";
import { isMiddenReady } from "./api/client";
import { routes } from "./routes";
import {
  getConfig,
  isCharnelMode,
  onConfigChanged,
  onEvent,
  takePendingDeepLinks,
  fetchLocalNodeId,
  setLocalNodeIdValue,
  type TauriEvent,
} from "./services/charnel";
import {
  checkRemoteHealth,
  getAllRemotes,
  getRemoteByPeerAddr,
  markRemoteOffline,
  refreshTauriRemoteTimestamp,
  upsertTauriRemote,
} from "./services/remotes/remoteManager";
import { drainIdbRemotesToSqlite } from "./services/remotes/drainIdbToSqlite";
import {
  applyServiceWorkerUpdate,
  dismissUpdate,
  registerServiceWorker,
  updateAvailable,
} from "./services/serviceWorker";
import { initAppDB, setSyncQueueToLocal } from "./services/storage/db";
import { isP2PRemote } from "./services/storage/types";
import { checkPendingKnocks, showKnockCreatedToast } from "./services/toastNotices";

export function App() {
  const queryClient = useQueryClient();
  const isAddMusicOpen = useAddMusicState();
  const [isAddRemoteOpen, setIsAddRemoteOpen] = createSignal(false);
  const [addRemoteInitialValue, setAddRemoteInitialValue] = createSignal<string | undefined>();
  const [shareToken, setShareToken] = createSignal<string | null>(null);
  const [hasSongs, setHasSongs] = createSignal(false);
  const [hasRemotes, setHasRemotes] = createSignal(false);
  const [isInitializing, setIsInitializing] = createSignal(true);
  const [showLoading, setShowLoading] = createSignal(false);

  // track unlisten functions for cleanup
  let tauriUnlisteners: (() => void)[] = [];

  // track current hash reactively (allows settings in empty state)
  const [currentHash, setCurrentHash] = createSignal(window.location.hash);
  const isSettingsRoute = () => currentHash().startsWith("#/settings");

  // listen for hash changes to update reactive state
  onMount(() => {
    const handleHashChange = () => setCurrentHash(window.location.hash);
    window.addEventListener("hashchange", handleHashChange);
    onCleanup(() => window.removeEventListener("hashchange", handleHashChange));
  });

  // check for ?r= query param (remote node_id from QR code share link)
  // if present, auto-open add remote modal with the value
  // NOTE: the ?r= param is cleared by AddRemoteModal after the pending remote is persisted
  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const remoteParam = params.get("r");
    if (remoteParam) {
      debug("App", `found ?r= param: ${remoteParam.slice(0, 16)}...`);
      setAddRemoteInitialValue(remoteParam);
      setIsAddRemoteOpen(true);
    }
  });

  // check for #?share=<token> in the url hash on every load + hash change.
  // see SEND_TO_REMOTE_PLAN step 15 — ResolveShareModal handles decode +
  // routing; this just spots the token and forwards it.
  onMount(() => {
    const handle = () => {
      const token = extractShareTokenFromHash(window.location.hash);
      if (token && token !== shareToken()) {
        debug("App", `found share token: ${token.slice(0, 16)}...`);
        setShareToken(token);
      }
    };
    handle();
    window.addEventListener("hashchange", handle);
    onCleanup(() => window.removeEventListener("hashchange", handle));
  });

  // tauri cold-start: drain any deep-link urls received before the spume
  // event listener was wired up. step 16 of SEND_TO_REMOTE_PLAN.
  onMount(() => {
    if (!isCharnelMode()) return;
    void (async () => {
      const urls = await takePendingDeepLinks();
      for (const url of urls) {
        const token = extractDeepLinkShareToken(url);
        if (token) {
          debug("App", `cold-start deep link token: ${token.slice(0, 16)}...`);
          setShareToken(token);
          // only one resolver modal at a time; subsequent urls are dropped.
          break;
        }
      }
    })();
  });

  // tauri: cache the local iroh node id so share links + send-to-remote
  // work from the charnel-managed local remote (which has no peer_addr
  // of its own — it dispatches over IPC, but the same binary runs an
  // iroh endpoint we can hand out).
  onMount(() => {
    if (!isCharnelMode()) return;
    void (async () => {
      const id = await fetchLocalNodeId();
      setLocalNodeIdValue(id);
      if (id) debug("App", `local node id: ${id.slice(0, 16)}...`);
    })();
  });

  // strip the share param out of `window.location.hash` once the modal closes
  // (success, dismiss, or unmatched + add-remote handoff).
  const clearShareToken = () => {
    setShareToken(null);
    const hash = window.location.hash;
    const stripped = hash.startsWith("#") ? hash.slice(1) : hash;
    const qIdx = stripped.indexOf("?");
    if (qIdx < 0) return;
    const path = stripped.slice(0, qIdx);
    const params = new URLSearchParams(stripped.slice(qIdx + 1));
    params.delete(SHARE_HASH_PARAM);
    const rest = params.toString();
    const newHash = path + (rest ? `?${rest}` : "");
    // history.replaceState avoids triggering hashchange listeners.
    history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${newHash ? `#${newHash}` : ""}`
    );
  };

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

  // handle events from tauri (config changes, scan completion)
  function handleTauriEvent(event: TauriEvent) {
    debug(`tauri event: ${event.type}`, event.data);

    switch (event.type) {
      case "config-changed":
        // show persistent toast with reload button
        // key ensures deduplication, message updates if toast already showing
        toast.custom(
          (props) => (
            <ConfigChangedToast
              toastId={props.toastId}
              message={props.message}
              onReload={() => window.location.reload()}
            />
          ),
          { key: "config-changed", message: event.data.message }
        );
        break;

      case "server-image-updated":
        // refetch config to get new server_image_path and update remote
        console.log("[handleTauriEvent] server-image-updated event received");
        void (async () => {
          const newConfig = await getConfig();
          console.log("[handleTauriEvent] server-image-updated: got config", {
            server_name: newConfig?.server_name,
            server_image_path: newConfig?.server_image_path,
          });
          if (newConfig) {
            await upsertTauriRemote({
              name: newConfig.server_name,
              base_url: newConfig.server_url,
              server_image_path: newConfig.server_image_path ?? undefined,
            });
            console.log("[handleTauriEvent] server-image-updated: refreshed remote");
          } else {
            // fallback: just update timestamp for cache-busting
            void refreshTauriRemoteTimestamp();
          }
        })();
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

      case "scan-complete":
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
          `scan complete: ${event.data.songs_added} songs, ${event.data.albums_added} albums, ${event.data.artists_added} artists added`
        );
        break;

      case "knock-created":
        // show toast for federation knock request with federation view button
        showKnockCreatedToast(event.data.username, event.data.message);
        break;

      case "peer-offline":
        // P2P connection failure - mark remote offline immediately
        void (async () => {
          const remote = await getRemoteByPeerAddr(event.data.peer_addr);
          if (remote) {
            debug(`peer-offline event: marking ${remote.name} as offline (${event.data.reason})`);
            await markRemoteOffline(remote.remote_id);
            // toast is shown by remoteSource when the request fails
            // this just ensures offline status is set before the timeout
          } else {
            debug(
              `peer-offline event: no remote found for peer_addr ${event.data.peer_addr.slice(0, 16)}...`
            );
          }
        })();
        break;

      case "share-link-received": {
        // os handed off a `freqhole://o/<token>` url. extract token and
        // route through the same ResolveShareModal flow used for web urls.
        const token = extractDeepLinkShareToken(event.data.url);
        if (token) {
          debug("App", `deep link share token: ${token.slice(0, 16)}...`);
          setShareToken(token);
        } else {
          debug("App", `deep link without share token: ${event.data.url}`);
        }
        break;
      }
    }
  }

  // auto-setup remote from tauri bridge (for tauri desktop app)
  async function autoSetupRemoteFromTauriBridge() {
    if (!isCharnelMode()) {
      debug("not in tauri mode, skipping bridge setup");
      return;
    }

    debug("tauri mode detected, requesting config via command...");
    const config = await getConfig();

    if (!config) {
      debug("no config from tauri, server may not be ready yet");
      return;
    }

    console.log("[autoSetupRemoteFromTauriBridge] got config from tauri:", {
      server_name: config.server_name,
      server_url: config.server_url,
      server_image_path: config.server_image_path,
      disable_backdrop_blur: config.disable_backdrop_blur,
      sync_queue_to_local: config.sync_queue_to_local,
    });

    // sync charnel config to spume AppState
    await setSyncQueueToLocal(config.sync_queue_to_local ?? true);

    try {
      // upsert creates or updates the tauri-managed remote
      const remote = await upsertTauriRemote({
        name: config.server_name,
        base_url: config.server_url,
        server_image_path: config.server_image_path ?? undefined,
      });
      // use useRemoteSource to properly switch data source AND set active_remote_id
      await useRemoteSource(remote);
      debug(`activated tauri remote: ${remote.name} (${remote.base_url})`);

      // subscribe to config changes (server restarts) - refetch config when notified
      const unlistenConfigChanged = await onConfigChanged(async () => {
        debug("tauri: config changed event received, refetching...");
        const newConfig = await getConfig();
        if (newConfig) {
          const updatedRemote = await upsertTauriRemote({
            name: newConfig.server_name,
            base_url: newConfig.server_url,
            server_image_path: newConfig.server_image_path ?? undefined,
          });
          await useRemoteSource(updatedRemote);
          queryClient.invalidateQueries();
          debug(`tauri remote updated: ${updatedRemote.name} (${updatedRemote.base_url})`);
        }
      });
      tauriUnlisteners.push(unlistenConfigChanged);

      // subscribe to all tauri events (scan progress, etc.)
      const unlistenEvent = await onEvent((event: TauriEvent) => handleTauriEvent(event));
      tauriUnlisteners.push(unlistenEvent);
    } catch (error) {
      console.error("failed to setup tauri remote:", error);
    }
  }

  // request persistent storage (web mode only, skipped in Tauri/charnel)
  async function requestPersistentStorage(): Promise<void> {
    if (isCharnelMode()) {
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
        toast.custom(
          (props) => (
            <UpdateAvailableToast
              toastId={props.toastId}
              onUpgrade={() => {
                toast.dismiss(props.toastId);
                applyServiceWorkerUpdate();
              }}
              onDismiss={() => {
                toast.dismiss(props.toastId);
                dismissUpdate();
              }}
            />
          ),
          { key: "update-available", message: "" }
        );
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

      // tauri-only: one-shot drain of IDB remotes into shared sqlite table.
      // no-op outside tauri or after first successful drain.
      // see docs/wizard-remote-admin.md.
      await drainIdbRemotesToSqlite();

      // auto-setup remote from tauri bridge (for desktop app)
      // this is fast since it's local IPC
      await autoSetupRemoteFromTauriBridge();

      // for non-tauri, use local source immediately (no blocking remote connection)
      // RemoteContextHandler will handle connecting to remotes when navigating
      if (!isCharnelMode()) {
        await useLocalSource();
      }

      // background health check of ALL remotes (non-blocking)
      // updates offline status in IDB so TopNav shows correct status
      // skip P2P remotes until midden is initialized to avoid "Cannot access before initialization" errors
      void (async () => {
        const allRemotes = await getAllRemotes();
        if (allRemotes.length > 0) {
          // filter out P2P remotes if midden isn't ready yet
          const remotesToCheck = allRemotes.filter((r) => {
            if (isP2PRemote(r) && !isMiddenReady()) {
              debug("App", `skipping health check for P2P remote ${r.name} (midden not ready)`);
              return false;
            }
            return true;
          });
          if (remotesToCheck.length > 0) {
            debug("App", `background: checking health of ${remotesToCheck.length} remotes`);
            await Promise.all(remotesToCheck.map((r) => checkRemoteHealth(r)));
            debug("App", "background: health check complete");
          }
        }
      })();

      // initialize cache network handlers (online/offline events)
      initCacheNetworkHandlers();

      // seed reactive cache set from existing metadata
      await initCachedAudioURLs();

      // initialize download state (synced sha256s from IDB/grimoire)
      await initDownloadState();

      // register service worker (prod web mode only)
      void registerServiceWorker();

      // request persistent storage (prod web mode only)
      void requestPersistentStorage();

      // check if we have any remotes configured
      const remotes = await getAllRemotes();
      setHasRemotes(remotes.length > 0);

      // check if we have any songs (use local source for quick check)
      const source = getDataSource();
      const result = await source.getSongs({ limit: 1 });
      setHasSongs(result.total > 0);

      // check for pending knock requests (tauri only, non-blocking)
      // shows persistent toast if there are access requests waiting
      void checkPendingKnocks();
    } finally {
      clearTimeout(loadingTimer);
      setIsInitializing(false);
      setShowLoading(false);
    }
  });

  // cleanup cache network handlers and tauri listeners on unmount
  onCleanup(() => {
    cleanupCacheNetworkHandlers();
    // cleanup tauri event listeners to prevent accumulation on HMR
    tauriUnlisteners.forEach((unlisten) => unlisten());
    tauriUnlisteners = [];
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

  // handle paths selected via tauri dialog (desktop only, Android uses file input)
  // supports local import (no remote), charnel-managed local remotes, and P2P remotes
  const handlePathsSelected = async (paths: string[]) => {
    const remote = getCurrentRemote();

    if (!remote) {
      // local import from file paths: read files via tauri-plugin-fs and import locally
      try {
        const fsModule = (await import("@tauri-apps/plugin-fs" as any)) as {
          readFile: (path: string) => Promise<Uint8Array>;
        };

        const files: File[] = [];
        for (const filePath of paths) {
          try {
            const data = await fsModule.readFile(filePath);
            const filename = filePath.split("/").pop() || filePath.split("\\").pop() || "audio.mp3";
            // guess mime from extension
            const ext = filename.split(".").pop()?.toLowerCase() || "";
            const mimeMap: Record<string, string> = {
              mp3: "audio/mpeg",
              flac: "audio/flac",
              wav: "audio/wav",
              m4a: "audio/mp4",
              ogg: "audio/ogg",
              aac: "audio/aac",
              alac: "audio/alac",
              wma: "audio/x-ms-wma",
            };
            files.push(
              new File([data as BlobPart], filename, { type: mimeMap[ext] || "audio/mpeg" })
            );
          } catch (err) {
            console.error("failed to read file:", filePath, err);
          }
        }

        if (files.length > 0) {
          const dt = new DataTransfer();
          files.forEach((f) => dt.items.add(f));
          await handleFilesSelected(dt.files);
        }
      } catch (error) {
        console.error("failed to import local paths:", error);
        toast.error("failed to read files", { title: "import error" });
      }
      return;
    }

    // P2P remote: upload each file via iroh-blobs pull model
    // (import into local blobs store, then remote peer pulls via verified streaming)
    if (remote.peer_addr) {
      await uploadPathsToRemote(paths, onRemoteJobComplete);
      return;
    }

    // charnel-managed local remote: send paths directly (server reads from disk)
    if (!remote.is_charnel_managed) {
      toast.warning("path-based import is only available for local or P2P remotes", {
        title: "not supported",
      });
      return;
    }

    try {
      const client = await getRemoteClient();
      if (!client) {
        toast.error("no remote client available", { title: "import error" });
        return;
      }

      // use musicByPaths to import files/directories
      const result = await client.upload.musicByPaths(paths, { waitForCompletion: false });
      if (result.success && result.data) {
        const data = result.data;
        if (data.jobs_created > 0) {
          toast.success(data.message, { title: "import started" });
          // invalidate queries after import starts
          onRemoteJobComplete();
        } else if (data.files_skipped > 0) {
          toast.info(`skipped ${data.files_skipped} files (no supported audio found)`, {
            title: "nothing to import",
          });
        } else {
          toast.info("no audio files found", { title: "nothing to import" });
        }
      } else {
        const errMsg =
          (!result.success && result.error?.issues?.[0]?.message) || "failed to start import";
        toast.error(errMsg, { title: "import error" });
      }
    } catch (error) {
      console.error("failed to import paths:", error);
      toast.error("failed to start import", { title: "import error" });
    }
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
        onPathsSelected={handlePathsSelected}
        onUrlsSubmitted={handleUrlsSubmitted}
        remoteName={getCurrentRemote()?.name}
        useCharnelDialog={isCharnelMode()}
        uploadJobs={getUploadJobs()}
        localImportProgress={getLocalImportProgress()}
      />

      <AddRemoteModal
        isOpen={isAddRemoteOpen()}
        onClose={() => {
          setIsAddRemoteOpen(false);
          setAddRemoteInitialValue(undefined);
        }}
        onSuccess={(remote) => {
          debug("App", "remote added successfully:", remote.name);
          // show success toast
          toast.success(`connected to ${remote.name}`, {
            title: "remote added",
          });
          // activate and switch to the newly added remote
          void (async () => {
            await useRemoteSource(remote);
            setHasRemotes(true);
            const source = getDataSource();
            const result = await source.getSongs({ limit: 1 });
            setHasSongs(result.total > 0);
            // navigate to remote feed view
            window.location.hash = `/${remote.remote_id}/feed`;
          })();
        }}
        initialValue={addRemoteInitialValue()}
      />

      <ResolveShareModal
        token={shareToken()}
        onClose={clearShareToken}
        onAddRemote={(nodeId) => {
          setAddRemoteInitialValue(nodeId);
          setIsAddRemoteOpen(true);
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

      <Show when={useShareModalState()()}>
        {(state) => (
          <ShareModal
            isOpen={true}
            onClose={hideShareModal}
            target={state().target}
            source={state().source()}
            buildSendPayload={state().buildSendPayload}
            webHost={state().webHost}
          />
        )}
      </Show>

      {/* queue full modal (global, managed by queue service) */}
      <QueueFullModal />
    </>
  );
}

export default App;

/**
 * extract a share token from a `freqhole://` deep-link url.
 * accepts both `freqhole://o/<token>` and `freqhole://share/<token>` shapes
 * for forward-compat. returns null if the url isn't recognized.
 */
function extractDeepLinkShareToken(url: string): string | null {
  if (!url) return null;
  // strip scheme — `URL` parsing on custom schemes is inconsistent across
  // platforms, so do it by hand.
  const stripped = url.replace(/^freqhole:\/\//i, "");
  const m = stripped.match(/^(?:o|share)\/([^?#/]+)/i);
  return m ? m[1] : null;
}
