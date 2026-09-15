// main app entry point with routing
import { HashRouter } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, on, onCleanup, onMount, Show, batch } from "solid-js";
import { EmptyState } from "../components/EmptyState";
import { ConfigChangedToast } from "../components/feedback/ConfigChangedToast";
import { toast } from "../components/feedback/Toast";
import { UpdateAvailableToast } from "../components/feedback/UpdateAvailableToast";
import { TitleBarStrip } from "../components/layout/TitleBarStrip";
import { AddMediaModal } from "../components/modals/AddMediaModal";
import { AddRemoteModal } from "../components/modals/AddRemoteModal";
import { AlbumEditorModal } from "../components/modals/AlbumEditorModal";
import { ArtistEditorModal } from "../components/modals/ArtistEditorModal";
import { BulkEditVideosModal } from "../components/modals/BulkEditVideosModal";
import { EditVideoModal } from "../components/modals/EditVideoModal";
import { EditVideoSeriesModal } from "../components/modals/EditVideoSeriesModal";
import { ImageCarouselModal } from "../components/modals/ImageCarouselModal";
import { ResolveShareModal } from "../components/modals/ResolveShareModal";
import { RemotePickerModal } from "../components/modals/RemotePickerModal";
import { LOCAL_WEB_TARGET_ID } from "../components/forms/LocalTargetPicker";
import { ShareModal } from "../components/modals/ShareModal";
import { SongEditorModal } from "../components/modals/SongEditorModal";
import { TagSelectorModal } from "../components/modals/TagSelectorModal";
import { BulkEnrichmentReviewModal } from "../library/review/BulkEnrichmentReviewModal";
import { hideBulkReview, useBulkReviewState } from "../library/review/bulkReviewModal";
import { QueueFullModal } from "../music/components/QueueFullModal";
import { ReplaceQueueConfirmModal } from "../music/components/ReplaceQueueConfirmModal";
import { getCurrentRemote, getDataSource, useLocalSource, useRemoteSource } from "../music/data";
import type { CurrentRemoteInfo } from "../music/data/currentState";
import { isAdmin } from "../music/data/permissions";
import {
  createCandidateDestinations,
  refreshCandidateDestinations,
} from "../music/services/send/destinationCandidates";
import {
  hideAlbumEditor,
  hideArtistEditor,
  hideImageCarousel,
  hideSongEditor,
  hideTagSelector,
  hideShareModal,
  showSongEditor,
  useAlbumEditorState,
  useArtistEditorState,
  useImageCarouselState,
  useShareModalState,
  useSongEditorState,
  useTagSelectorState,
} from "../music/hooks/modals";
import { openAddMedia, closeAddMedia, useAddMediaState } from "./hooks/mediaModal";
import {
  clearCompletedJobs,
  clearLocalImportProgress,
  fetchUrlsOnRemote,
  getLocalImportProgress,
  getUploadJobs,
  importMusicFiles,
  importPathsToLocal,
  uploadFilesToRemote,
} from "../music/import";
import {
  hideBulkEditVideos,
  hideEditVideo,
  hideEditVideoSeries,
  useBulkEditVideosState,
  useEditVideoState,
  useEditVideoSeriesState,
} from "../video/hooks/modals";
import {
  clearLocalVideoImportProgress,
  getLocalVideoImportProgress,
  importVideoFiles,
} from "../video/import/localImport";
import { initVideoSyncState } from "../video/services/syncState";
import { getVideoDataSource } from "../video/data";
import {
  clearCompletedVideoJobs,
  fetchVideoUrlsOnRemote,
  getVideoUploadJobs,
  importVideoPathsToLocal,
  uploadVideoFilesToRemote,
} from "../video/import/remoteImport";
import { togglePlayback } from "../music/services/audio/player";
import { initRodioPreference } from "../music/services/audio/select";
import { initVideoWindowPreference } from "../music/services/audio/selectVideo";
import { initRemotePlaybackBootstrap } from "../cenotaph/adapters/bootstrap";
import { swapPlayerBackend } from "../music/services/audio/player";
import { initQueueSizeLimit } from "../music/services/queue/queueLimit";
import {
  cleanupCacheNetworkHandlers,
  initCachedAudioURLs,
  initCacheNetworkHandlers,
} from "../music/services/cache/blobCache";
import { initDownloadState } from "../music/services/download";
import { addToQueue } from "../music/services/queue/queue";
import { initMusicDB } from "../music/services/storage/db";
import { recoverLegacyImages } from "../music/services/storage/legacyImageRecovery";
import type { Song } from "../music/services/storage/types";
import { debug } from "../utils/logger";
import { extractShareTokenFromHash, SHARE_HASH_PARAM } from "../utils/permalink";
import { addRemoteRequest } from "./services/remotes/addRemoteRequest";
import { AUDIO_EXTS, VIDEO_EXTS } from "../utils/filePicker";
import { onMiddenReady, getClientForRemote } from "./api/client";
import { routes } from "./routes";
import {
  getConfig,
  isCharnelMode,
  onConfigChanged,
  onEvent,
  takePendingDeepLinks,
  fetchLocalNodeId,
  setLocalNodeIdValue,
  getTargetOs,
  setTargetOsValue,
  type TauriEvent,
} from "./services/charnel";
import {
  checkRemoteHealth,
  createRemote,
  getAllRemotes,
  getRemoteByPeerAddr,
  getTauriManagedRemote,
  markRemoteOffline,
  onRemoteStatusChange,
  refreshTauriRemoteTimestamp,
  upsertTauriRemote,
} from "./services/remotes/remoteManager";
import { drainIdbRemotesToSqlite } from "./services/remotes/drainIdbToSqlite";
import { setPendingSendTarget, getPendingSendTarget } from "./services/send/pendingSendTargets";
import { sendReviewedAlbumsToRemote } from "./services/send/sendReviewedSessionToRemote";
import type { SendReviewProgress } from "./services/send/sendReviewProgress";
import { sendReviewedLocalAlbumsToRemote } from "./services/send/sendReviewedLocalSessionToRemote";
import { sendReviewedVideosToRemote } from "./services/send/sendReviewedVideoSessionToRemote";
import type { Remote } from "./services/storage/schemas/remote";
import { checkPendingKnockApprovals } from "./services/remotes/pendingKnockChecker";
import {
  applyServiceWorkerUpdate,
  dismissUpdate,
  registerServiceWorker,
  updateAvailable,
} from "./services/serviceWorker";
import { initAppDB, setSyncQueueToLocal } from "./services/storage/db";
import { setDisableBackdropBlur } from "./services/backdropBlur";
import { recordSharedItemFromToken } from "./services/storage/sharedItems";
import { isP2PRemote } from "./services/storage/types";
import { checkPendingKnocks, showKnockCreatedToast } from "./services/toastNotices";
import { useFetchPrecheckEnabledQuery } from "../music/hooks/useFetchPrecheckEnabled";
import { useFetchVideoEnabledQuery } from "../music/hooks/useFetchVideoEnabled";
import { useImportReview } from "../music/hooks/useImportReview";
import {
  dispatchImportSession,
  importSessionState,
  LOCAL_TARGET_KEY,
} from "../music/hooks/useImportSessionFlow";
import { resolveActiveReviewRemote } from "../music/services/review/reviewBackend";
import { ImportReviewModal } from "../components/modals/ImportReviewModal";
import { ImportReviewEditor } from "../components/import/ImportReviewEditor";
import { useVideoImportReview } from "../video/hooks/useVideoImportReview";
import { ImportVideoReviewModal } from "../components/modals/ImportVideoReviewModal";
import { ImportVideoReviewEditor } from "../components/import/ImportVideoReviewEditor";

export function App() {
  const queryClient = useQueryClient();
  const isAddMediaOpen = useAddMediaState();
  const [isAddRemoteOpen, setIsAddRemoteOpen] = createSignal(false);
  const [addRemoteInitialValue, setAddRemoteInitialValue] = createSignal<string | undefined>();
  const [addRemoteInitialIntent, setAddRemoteInitialIntent] = createSignal<"player" | undefined>();
  // session id for the import review modal - set when user clicks "review now"
  const [reviewSessionId, setReviewSessionId] = createSignal<string | null>(null);
  // the remote that owns the review session - captured at start time so it stays
  // stable even if the user navigates to a different remote while reviewing
  const [reviewRemote, setReviewRemote] = createSignal<CurrentRemoteInfo | null>(null);

  // open a review session, capturing the active remote at this moment.
  // in charnel mode this is always the local instance (path-based imports
  // redirect through local-first import - see handlePathsSelected), not
  // whatever remote happens to be selected in the UI. outside charnel,
  // review sessions live entirely in the browser's own IndexedDB library -
  // there's no Remote at all for useImportReview to resolve, so it's
  // signalled with null (see reviewBackend.ts's resolveActiveReviewRemote,
  // the one place this decision is made - AddMediaModal.tsx uses the same
  // resolver for its pending-sessions listing).
  async function openReviewSession(sid: string) {
    const remote = await resolveActiveReviewRemote();
    batch(() => {
      setReviewRemote((remote as unknown as CurrentRemoteInfo) ?? null);
      setReviewSessionId(sid);
      // "opened" always yields a fresh { kind: "reviewing", albumIds: [] }
      // for this target - see importSessionReducer.ts's doc comment for why
      // this makes the stale-progress-on-reopen bug structurally impossible
      // rather than something that has to be remembered to reset by hand.
      dispatchImportSession(
        reviewTargetKey(remote as unknown as CurrentRemoteInfo | null, "music"),
        { type: "opened", sessionId: sid }
      );
    });
  }
  // incremented when the review modal closes - triggers AddMediaModal to refetch pending sessions
  const [reviewRefetchKey, setReviewRefetchKey] = createSignal(0);
  // last session id that completed review - triggers AddMediaModal to auto-dismiss its card
  const [completedReviewSessionId, setCompletedReviewSessionId] = createSignal<string | null>(null);
  // target-registry key for whichever remote a review session is against -
  // "local" sentinel for the browser-local/charnel-managed backend, so
  // switching targets in the future (§11) never blends two sessions' state.
  // prefixed by domain so a music session and a video session both destined
  // for the same remote never share (and blend) one registry entry.
  const reviewTargetKey = (remote: CurrentRemoteInfo | null, domain: "music" | "video") =>
    `${domain}:${remote?.remote_id ?? LOCAL_TARGET_KEY}`;
  // non-null while a send is running or has just finished for the
  // currently-displayed review session - derived from the registry (not its
  // own signal) so a freshly-opened session can never inherit a previous
  // session's stale progress (finding A).
  const reviewSendProgress = (): SendReviewProgress | null => {
    const state = importSessionState(reviewTargetKey(reviewRemote(), "music"));
    return state.kind === "sending" || state.kind === "done" ? state.progress : null;
  };

  // video counterpart of reviewSendProgress above.
  const reviewVideoSendProgress = (): SendReviewProgress | null => {
    const state = importSessionState(reviewTargetKey(reviewVideoRemote(), "video"));
    return state.kind === "sending" || state.kind === "done" ? state.progress : null;
  };

  // session id for the video import review modal - set when user clicks "review now"
  const [reviewVideoSessionId, setReviewVideoSessionId] = createSignal<string | null>(null);
  // the remote that owns the video review session - captured at start time, same reasoning as reviewRemote
  const [reviewVideoRemote, setReviewVideoRemote] = createSignal<CurrentRemoteInfo | null>(null);

  // open a video review session, capturing the active remote at this
  // moment - resolves through resolveActiveReviewRemote() (not
  // getCurrentRemote()), same reasoning as openReviewSession above: video's
  // local-first import always redirects to the local grimoire instance
  // regardless of which remote is currently being browsed.
  async function openReviewVideoSession(sid: string) {
    const remote = await resolveActiveReviewRemote();
    batch(() => {
      setReviewVideoRemote(remote);
      setReviewVideoSessionId(sid);
      dispatchImportSession(reviewTargetKey(remote, "video"), { type: "opened", sessionId: sid });
    });
  }
  // last video session id that completed review - triggers AddMediaModal to auto-dismiss its card
  const [completedVideoReviewSessionId, setCompletedVideoReviewSessionId] = createSignal<
    string | null
  >(null);

  // explicit override of which remote new add-media uploads/imports should
  // target - null means "no override yet, follow whatever's currently
  // browsed" (getCurrentRemote()), matching the exact default behavior from
  // before this switcher existed. once the user picks a destination via
  // AddMediaModal's header picker, this pins to that choice regardless of
  // what the user browses to elsewhere - see docs/add-media-review-refactor-
  // plan.md §11: switching targets must never lose in-flight review/send
  // state, which is why this is purely "which registry entry is displayed"
  // rather than anything that touches session data itself.
  const [addMediaTargetId, setAddMediaTargetId] = createSignal<string | null>(null);
  // candidate destinations for the picker - same eligibility (p2p remotes +
  // the charnel-managed local remote) the share flow's SendToRemoteSection
  // already uses, so a destination that can't actually receive a sync/
  // upload is never offered here either.
  const addMediaCandidates = createCandidateDestinations({ sourceRemoteId: () => undefined });
  const addMediaTargetRemote = (): CurrentRemoteInfo | null => {
    const id = addMediaTargetId();
    if (id === null) return getCurrentRemote();
    // explicit "local (this browser)" pick from plain web's LocalTargetPicker
    // (see that file's doc comment) - distinct from `id === null`'s "no
    // override yet, follow whatever remote is currently browsed" default.
    if (id === LOCAL_WEB_TARGET_ID) return null;
    const candidate = addMediaCandidates().find((c) => c.remote.remote_id === id);
    return candidate ? (candidate.remote as unknown as CurrentRemoteInfo) : getCurrentRemote();
  };

  // signals the AddRemoteModal to auto-complete setup for a peer (device-linked / knock-accepted)
  const [autoCompletePeerAddr, setAutoCompletePeerAddr] = createSignal<string | null>(null);
  const [shareToken, setShareToken] = createSignal<string | null>(null);
  const [hasSongs, setHasSongs] = createSignal(false);
  // videos count as media too - the welcome gate predates the video domain and
  // used to keep showing after importing only videos.
  const [hasVideos, setHasVideos] = createSignal(false);
  const [hasRemotes, setHasRemotes] = createSignal(false);
  const [isInitializing, setIsInitializing] = createSignal(true);
  const [showLoading, setShowLoading] = createSignal(false);

  // track unlisten functions for cleanup
  let tauriUnlisteners: (() => void)[] = [];

  // track current hash reactively (allows settings + radio in empty state)
  const [currentHash, setCurrentHash] = createSignal(window.location.hash);
  const isSettingsRoute = () => currentHash().startsWith("#/settings");

  // query whether the add-media target remote has url precheck (yt-dlp)
  // configured - keyed to the switcher's effective target, not whatever's
  // currently being browsed (see addMediaTargetRemote's doc comment).
  const fetchPrecheckEnabledQuery = useFetchPrecheckEnabledQuery(
    () => addMediaTargetRemote() ?? undefined
  );

  // query whether the add-media target remote has video url fetching (fetch_video) configured
  const fetchVideoEnabledQuery = useFetchVideoEnabledQuery(
    () => addMediaTargetRemote() ?? undefined
  );

  // import review - keyed to the captured remote for the session, not getCurrentRemote()
  const importReview = useImportReview(
    () => reviewSessionId(),
    () => reviewRemote()
  );
  // map of albumId -> save fn registered by ImportReviewEditor instances
  const editorSaveFns = new Map<string, () => Promise<void>>();

  // video import review - same pattern as importReview above
  const videoImportReview = useVideoImportReview(
    () => reviewVideoSessionId(),
    () => reviewVideoRemote()
  );
  // map of groupKey -> save fn registered by ImportVideoReviewEditor instances
  const videoEditorSaveFns = new Map<string, () => Promise<void>>();

  // when albums drain to zero while the modal is open (e.g. after a merge
  // marks everything reviewed server-side), treat it as a completion so the
  // add-media modal re-opens for the next pending session.
  createEffect(() => {
    const sid = reviewSessionId();
    if (!sid) return;
    const ids = importReview.albums().map((a) => a.id);
    if (ids.length === 0) return;
    dispatchImportSession(reviewTargetKey(reviewRemote(), "music"), {
      type: "albumsSeen",
      albumIds: ids,
    });
  });

  createEffect(() => {
    if (reviewSessionId() && !importReview.loading() && importReview.albums().length === 0) {
      const sid = reviewSessionId()!;
      const localRemote = reviewRemote();
      const key = reviewTargetKey(localRemote, "music");

      // guard against this effect re-firing for a session that's already
      // moved past "reviewing" (e.g. a second, spurious zero-albums read
      // right after the transition below already ran once).
      const state = importSessionState(key);
      if (state.kind !== "reviewing" || state.sessionId !== sid) return;

      // durable, server-side (grimoire) or local-idb backed - not the
      // same-session-only pendingSendTargets store (still used below by
      // checkAutoSendForCompletedSessions, which only ever needs to know
      // about jobs from this same app run anyway).
      const targetId = importReview.targetRemoteId();
      const targetName = importReview.targetRemoteName();
      const target = targetId && targetName ? { id: targetId, name: targetName } : null;

      dispatchImportSession(key, { type: "albumsDrained", target });
      const nextState = importSessionState(key);

      // destined for a real remote: keep the review modal open and render
      // send progress inline in it instead of closing immediately - once
      // the send resolves, the modal stays open showing the final tally
      // (see ImportReviewModal's footer: disabled "sending..." until
      // sendProgress.done, then an enabled "close") - the user's own close
      // click (below) is what actually tears the session down, not this.
      if (nextState.kind === "sending") {
        const albumIds = nextState.albumIds;
        const onProgress = (progress: SendReviewProgress) =>
          dispatchImportSession(key, { type: "sendProgress", progress });
        const sendPromise = localRemote
          ? sendReviewedAlbumsToRemote(
              sid,
              target!.id,
              target!.name,
              localRemote as unknown as Remote,
              albumIds,
              onProgress
            )
          : sendReviewedLocalAlbumsToRemote(target!.id, target!.name, albumIds, onProgress);
        void sendPromise.then(() => {
          dispatchImportSession(key, { type: "sendFinished" });
          setCompletedReviewSessionId(sid);
          setReviewRefetchKey((k) => k + 1);
        });
        return;
      }

      // no pending send target - close immediately, same as before.
      setCompletedReviewSessionId(sid);
      setReviewSessionId(null);
      setReviewRemote(null);
      setReviewRefetchKey((k) => k + 1);
      openAddMedia();
    }
  });

  // same as above, for video review groups
  createEffect(() => {
    const sid = reviewVideoSessionId();
    if (!sid) return;
    const ids = videoImportReview.groups().flatMap((g) => g.videos.map((v) => v.id));
    if (ids.length === 0) return;
    dispatchImportSession(reviewTargetKey(reviewVideoRemote(), "video"), {
      type: "albumsSeen",
      albumIds: ids,
    });
  });

  createEffect(() => {
    if (
      reviewVideoSessionId() &&
      !videoImportReview.loading() &&
      videoImportReview.groups().length === 0
    ) {
      const sid = reviewVideoSessionId();
      const localRemote = reviewVideoRemote();
      const key = reviewTargetKey(localRemote, "video");

      // guard against this effect re-firing for a session that's already
      // moved past "reviewing" - mirrors music's identical guard above.
      const state = importSessionState(key);
      if (!sid || state.kind !== "reviewing" || state.sessionId !== sid) return;
      const videoIds = state.albumIds;

      // durable send target set at import time (see useVideoImportReview's
      // targetRemoteId/targetRemoteName) - mirrors the equivalent music
      // effect above.
      const targetId = videoImportReview.targetRemoteId();
      const targetName = videoImportReview.targetRemoteName();
      const target = targetId && targetName ? { id: targetId, name: targetName } : null;

      dispatchImportSession(key, { type: "albumsDrained", target });
      const nextState = importSessionState(key);

      // destined for a real remote: keep the review modal open and render
      // send progress inline in it instead of closing immediately - mirrors
      // music's identical reasoning (see the comment right above the music
      // effect's own `if (nextState.kind === "sending")` branch).
      if (nextState.kind === "sending") {
        const onProgress = (progress: SendReviewProgress) =>
          dispatchImportSession(key, { type: "sendProgress", progress });
        void sendReviewedVideosToRemote(
          sid,
          target!.id,
          target!.name,
          localRemote as unknown as Remote,
          videoIds,
          onProgress
        ).then(() => {
          dispatchImportSession(key, { type: "sendFinished" });
          setCompletedVideoReviewSessionId(sid);
          setReviewRefetchKey((k) => k + 1);
        });
        return;
      }

      // no pending send target - close immediately, same as before.
      setCompletedVideoReviewSessionId(sid);
      setReviewVideoSessionId(null);
      setReviewVideoRemote(null);
      setReviewRefetchKey((k) => k + 1);
      openAddMedia();
    }
  });
  // radio works with zero remotes (anyone with a node id can listen)
  const isRadioRoute = () => currentHash().startsWith("#/radio");
  const isSharedRoute = () => currentHash().startsWith("#/shared");

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

    // check for ?link= param (device link flow from charnel app)
    // navigate to the #/link route which reads the param from window.location.search
    const linkParam = params.get("link");
    if (linkParam) {
      debug("App", "found ?link= param, navigating to /link");
      window.location.hash = "/link";
    }
  });

  // pasted/scanned add-remote links (e.g. a `?r=` url pasted into
  // TopNavSearch) arrive via this request channel rather than a query
  // param, since they're detected mid-session, not just on page load.
  createEffect(
    on(addRemoteRequest, (req) => {
      if (!req) return;
      debug("App", `add-remote request: ${req.value.slice(0, 16)}...`);
      setAddRemoteInitialValue(req.value);
      setAddRemoteInitialIntent(req.intent);
      setIsAddRemoteOpen(true);
    })
  );

  // check for #?share=<token> in the url hash on every load + hash change.
  // see SEND_TO_REMOTE_PLAN step 15 — ResolveShareModal handles decode +
  // routing; this just spots the token and forwards it.
  onMount(() => {
    const handle = () => {
      const token = extractShareTokenFromHash(window.location.hash);
      if (token && token !== shareToken()) {
        debug("App", `found share token: ${token.slice(0, 16)}...`);
        void recordSharedItemFromToken(token);
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
          void recordSharedItemFromToken(token);
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

  // tauri: cache the build's target OS ("macos"/"android"/...) so android
  // can be told apart from desktop reliably — `get_build_info` reports what
  // the binary was actually built for, unlike sniffing `navigator.userAgent`.
  onMount(() => {
    if (!isCharnelMode()) return;
    void (async () => {
      const os = await getTargetOs();
      setTargetOsValue(os);
      if (os) debug("App", `target os: ${os}`);
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
        {
          const d = event.data;
          const parts = [
            `${d.songs_added} songs`,
            `${d.albums_added} albums`,
            `${d.artists_added} artists added`,
          ];
          if (d.restored_songs && d.restored_songs > 0) {
            parts.push(`${d.restored_songs} restored`);
          }
          if (d.blobs_deleted && d.blobs_deleted > 0) {
            parts.push(`${d.blobs_deleted} missing`);
          }
          if (d.purged_scan_dirs && d.purged_scan_dirs > 0) {
            parts.push(`${d.purged_scan_dirs} dirs purged`);
          }
          toast.success(`scan complete: ${parts.join(", ")}`);
        }
        break;

      case "knock-created":
        // show toast for federation knock request with federation view button
        showKnockCreatedToast(event.data.username, event.data.message);
        break;

      case "device-linked": {
        // remote server confirmed charnel's node_id is registered.
        // if the modal is open, signal it to auto-complete; otherwise do it here.
        const { peer_addr, server_name } = event.data;
        if (isAddRemoteOpen()) {
          // modal is open - let it drive the completion and show its own success step
          setAutoCompletePeerAddr(peer_addr);
          // reset after a tick so the effect fires again if the same addr comes twice
          setTimeout(() => setAutoCompletePeerAddr(null), 100);
        } else {
          void (async () => {
            const existing = await getRemoteByPeerAddr(peer_addr);
            if (existing) {
              toast.success(`already connected to ${existing.name}`, {
                title: "device linked",
                action: {
                  label: "browse remote",
                  onClick: () => {
                    window.location.hash = `/${existing.remote_id}/feed`;
                  },
                },
                persistent: true,
              });
              return;
            }
            try {
              const remote = await createRemote({ peer_addr });
              toast.success(`${remote.name} added`, {
                title: "remote linked",
                action: {
                  label: "browse remote",
                  onClick: () => {
                    window.location.hash = `/${remote.remote_id}/feed`;
                  },
                },
                persistent: true,
              });
            } catch (err) {
              debug("App", `device-linked: createRemote failed for ${server_name}:`, err);
              toast.info(`passkey linked to ${server_name} - add the remote to browse`, {
                title: "device linked",
                action: {
                  label: "add remote",
                  onClick: () => {
                    setIsAddRemoteOpen(true);
                  },
                },
                persistent: true,
              });
            }
          })();
        }
        break;
      }

      case "knock-accepted": {
        // remote server accepted the knock request.
        // same as device-linked: drive modal completion if open, else toast+create.
        const { peer_addr, server_name } = event.data;
        if (isAddRemoteOpen()) {
          setAutoCompletePeerAddr(peer_addr);
          setTimeout(() => setAutoCompletePeerAddr(null), 100);
        } else {
          void (async () => {
            const existing = await getRemoteByPeerAddr(peer_addr);
            if (existing) {
              toast.success(`access granted to ${existing.name}`, {
                title: "knock accepted",
                action: {
                  label: "browse remote",
                  onClick: () => {
                    window.location.hash = `/${existing.remote_id}/feed`;
                  },
                },
                persistent: true,
              });
              return;
            }
            try {
              const remote = await createRemote({ peer_addr });
              toast.success(`${remote.name} added`, {
                title: "knock accepted",
                action: {
                  label: "browse remote",
                  onClick: () => {
                    window.location.hash = `/${remote.remote_id}/feed`;
                  },
                },
                persistent: true,
              });
            } catch (err) {
              debug("App", `knock-accepted: createRemote failed for ${server_name}:`, err);
              toast.info(`access granted to ${server_name} - add the remote to browse`, {
                title: "knock accepted",
                action: {
                  label: "add remote",
                  onClick: () => {
                    setIsAddRemoteOpen(true);
                  },
                },
                persistent: true,
              });
            }
          })();
        }
        break;
      }

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

      case "update-check-result": {
        // result of the desktop "check for updates" menu action.
        const d = event.data;
        if (d.error) {
          toast.error(`update check failed: ${d.error}`, { title: "updates" });
        } else if (d.update_available && d.latest_version) {
          // no link opener on desktop, so surface the download url as text the
          // user can visit. persistent so it stays put while they read it.
          toast.info(`version ${d.latest_version} is available — get it at ${d.download_url}`, {
            title: "updates",
            persistent: true,
          });
        } else {
          toast.success(`you're up to date (version ${d.current_version})`, { title: "updates" });
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

    // sync charnel config to spume AppState. skipped on android: there's no
    // wizard window there to manage `sync_queue_to_local`, so the toggle in
    // StorageSettingsView is the only source of truth for it — overwriting
    // it here on every cold start would silently revert the user's choice.
    if (!/android/i.test(navigator.userAgent)) {
      await setSyncQueueToLocal(config.sync_queue_to_local ?? true);
    }

    setDisableBackdropBlur(config.disable_backdrop_blur ?? false);

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
        // re-read the rodio opt-in flag — the wizard's settings view
        // toggles `use_rodio_playback` in `FreqholeAppConfig`, and we
        // want spume's `selectBackend()` to pick that up without a
        // page reload.
        await initRodioPreference();
        await initVideoWindowPreference();
        // re-read the queue size limit too in case the user edited
        // `[client] queue_size_limit` in their toml.
        await initQueueSizeLimit();
        // re-evaluate which PlayerBackend the facade owns. swap is a
        // no-op when the chosen kind hasn't changed; option (b)
        // "stop + swap" otherwise.
        await swapPlayerBackend();
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
                // best-effort, non-blocking: idempotent, so it's safe to
                // fire alongside the impending reload rather than await it
                // - a run interrupted by the reload just resumes next time.
                if (!isCharnelMode()) {
                  void recoverLegacyImages().catch((err) => {
                    console.error("legacy image recovery failed:", err);
                  });
                }
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

    // temporary boot-timing instrumentation (see slow-tauri-boot investigation) —
    // logs elapsed ms per step so the "loading..." screen's actual bottleneck
    // can be narrowed down instead of guessed at.
    const bootStart = performance.now();
    const mark = (label: string) => {
      console.info(`[perf] boot: ${label} at ${(performance.now() - bootStart).toFixed(1)}ms`);
    };

    try {
      await initAppDB();
      mark("initAppDB done");
      await initMusicDB();
      mark("initMusicDB done");

      // freqhole/1 hello route + freqhole-player/1 accept loop + local
      // library hooks, wired once midden becomes ready (registration is
      // idempotent and cheap, so it's fine to call before midden even
      // exists yet - see bootstrap.ts).
      initRemotePlaybackBootstrap();
      mark("initRemotePlaybackBootstrap done");

      // hydrate the rodio opt-in cache early so the very first
      // `selectBackend()` call observes the user's preference. safe
      // outside tauri (falls back to localStorage / defaults to false).
      await initRodioPreference();
      mark("initRodioPreference done");
      // resolve whether video can play in charnel's separate window (linux).
      // paired with the rodio opt-in, which also gates the video window.
      await initVideoWindowPreference();
      mark("initVideoWindowPreference done");
      // hydrate the configurable queue size limit from `[client]`
      // in `freqhole-config.toml`. safe outside tauri (no-op).
      await initQueueSizeLimit();
      mark("initQueueSizeLimit done");
      // player.ts is loaded eagerly via the import graph and called
      // `selectBackend()` before the cache was hydrated, so the initial
      // activeBackend is always html. swap now to pick up the persisted
      // setting on boot.
      await swapPlayerBackend();
      mark("swapPlayerBackend done");

      // tauri-only: one-shot drain of IDB remotes into shared sqlite table.
      // no-op outside tauri or after first successful drain.
      // see docs/wizard-remote-admin.md.
      await drainIdbRemotesToSqlite();
      mark("drainIdbRemotesToSqlite done");

      // auto-setup remote from tauri bridge (for desktop app)
      // this is fast since it's local IPC
      await autoSetupRemoteFromTauriBridge();
      mark("autoSetupRemoteFromTauriBridge done");

      // for non-tauri, use local source immediately (no blocking remote connection)
      // RemoteContextHandler will handle connecting to remotes when navigating
      if (!isCharnelMode()) {
        await useLocalSource();
        mark("useLocalSource done");

        // web-only: backfill any artist/album/song/playlist images left
        // behind by pre-reliquary local blob storage. idempotent and
        // non-blocking - also re-triggered from the update toast's
        // "upgrade" button, so this isn't the only chance to run it.
        void recoverLegacyImages().catch((err) => {
          console.error("legacy image recovery failed:", err);
        });
      }

      // background health check of ALL remotes (non-blocking)
      // updates offline status in IDB so TopNav shows correct status
      // skip P2P remotes until midden is initialized to avoid "Cannot access before initialization" errors
      void (async () => {
        const allRemotes = await getAllRemotes();
        if (allRemotes.length > 0) {
          // partition: http remotes can be checked now; p2p remotes have
          // to wait for midden to finish initializing.
          const httpRemotes = allRemotes.filter((r) => !isP2PRemote(r));
          const p2pRemotes = allRemotes.filter((r) => isP2PRemote(r));

          if (httpRemotes.length > 0) {
            debug("App", `background: checking health of ${httpRemotes.length} http remotes`);
            await Promise.all(httpRemotes.map((r) => checkRemoteHealth(r)));
            debug("App", "background: http health check complete");
          }

          if (p2pRemotes.length > 0) {
            // event-driven: kick off when midden is ready (fires sync
            // if it already is).
            onMiddenReady(async () => {
              debug(
                "App",
                `background: midden ready, checking health of ${p2pRemotes.length} p2p remotes`
              );
              await Promise.all(p2pRemotes.map((r) => checkRemoteHealth(r)));
              debug("App", "background: p2p health check complete");
            });
          }
        }
      })();

      // initialize cache network handlers (online/offline events)
      initCacheNetworkHandlers();

      // seed reactive cache set from existing metadata (non-blocking - this
      // is pure UI cache-badge state, validated against Cache Storage across
      // every remote ever added, and can be slow with a large library. the
      // reactive store updates in place once this resolves, so cache badges
      // just pop in a moment after first paint instead of gating it.
      void initCachedAudioURLs().then(() => mark("initCachedAudioURLs done (background)"));

      // initialize download state (synced sha256s from IDB/grimoire)
      await initDownloadState();
      mark("initDownloadState done");

      // seed reactive synced-video-ids state from IDB (non-blocking, mirrors
      // the song-sync store but only ever needed in browser mode)
      void initVideoSyncState().then(() => mark("initVideoSyncState done (background)"));

      // register service worker (prod web mode only)
      void registerServiceWorker();

      // request persistent storage (prod web mode only)
      void requestPersistentStorage();

      // check if we have any remotes configured
      const remotes = await getAllRemotes();
      setHasRemotes(remotes.length > 0);
      mark("getAllRemotes done");

      // check if we have any songs (use local source for quick check)
      const source = getDataSource();
      const result = await source.getSongs({ limit: 1 });
      setHasSongs(result.total > 0);
      mark("getSongs({limit:1}) done - initializing complete");

      // same for videos - a library with only videos still counts as set up
      try {
        const videoResult = await getVideoDataSource().getVideos({ limit: 1 });
        setHasVideos(videoResult.total_count > 0);
      } catch (e) {
        console.debug("[App] video presence check failed:", e);
      }

      // check for pending knock requests across every admin remote.
      // delayed slightly so the auth-status store + p2p transports have a
      // chance to warm up; also re-runs whenever a remote transitions
      // offline -> online.
      setTimeout(() => void checkPendingKnocks(), 3000);

      // poll any pending remotes stuck in `knock_pending` to see if the
      // admin approved them while spume was closed. deferred so midden /
      // p2p transports are warm before we try to reach the peers, and
      // staggered slightly so it doesn't pile onto the initial p2p
      // health-check burst above.
      onMiddenReady(() => {
        setTimeout(() => void checkPendingKnockApprovals(), 5000);
      });
    } finally {
      clearTimeout(loadingTimer);
      setIsInitializing(false);
      setShowLoading(false);
    }
  });

  // re-check pending knocks whenever a remote transitions offline -> online,
  // so admins are notified about requests waiting on remotes that were
  // unreachable at startup. coalesce bursts so several remotes coming
  // online together only trigger one rescan.
  let knockReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubKnocksReconnect = onRemoteStatusChange((_remoteId, isOffline) => {
    if (isOffline) return;
    if (knockReconnectTimer !== null) clearTimeout(knockReconnectTimer);
    knockReconnectTimer = setTimeout(() => {
      knockReconnectTimer = null;
      void checkPendingKnocks();
    }, 1500);
  });

  // cleanup cache network handlers and tauri listeners on unmount
  onCleanup(() => {
    cleanupCacheNetworkHandlers();
    unsubKnocksReconnect();
    // cleanup tauri event listeners to prevent accumulation on HMR
    tauriUnlisteners.forEach((unlisten) => unlisten());
    tauriUnlisteners = [];
  });

  // album ids already auto-sent by checkAutoSendForCompletedSessions -
  // prevents re-sending the same album on a later tick. tracked per-album
  // (not per-session) so a session that's PARTIALLY reviewed - some albums
  // are exact re-imports of already-known content, others are genuinely
  // new and still need interactive review - can still have its
  // already-known albums sent right away instead of the whole session
  // waiting on the slowest album to be manually reviewed.
  const autoSentAlbumIds = new Set<string>();

  // a locally-imported session that needed NO review at all (e.g. every
  // file resolved as an exact duplicate already in the local library, or
  // matched existing metadata outright) never gets a "review now" card -
  // reviewableSessions() only shows sessions with pending review albums -
  // so the user never opens it, and the normal "drained to zero while the
  // review modal is open" completion effect never runs for it either. that
  // left such sessions permanently stuck in the local library with a
  // registered pendingSendTarget nobody ever acted on. this checks
  // pendingSendTargets directly against completed upload jobs and sends
  // review-free albums immediately, instead of requiring the interactive
  // review flow to have run at all - per-album, not per-session (see
  // autoSentAlbumIds above), so an exact duplicate isn't held hostage by a
  // sibling album in the same batch that genuinely needs review.
  async function checkAutoSendForCompletedSessions() {
    const bySession = new Map<string, { albumIds: Set<string>; allSettled: boolean }>();
    for (const j of getUploadJobs()) {
      if (!j.sessionId || !getPendingSendTarget(j.sessionId)) continue;
      let entry = bySession.get(j.sessionId);
      if (!entry) {
        entry = { albumIds: new Set(), allSettled: true };
        bySession.set(j.sessionId, entry);
      }
      if (j.albumId) entry.albumIds.add(j.albumId);
      if (j.status !== "completed" && j.status !== "failed") entry.allSettled = false;
    }

    for (const [sid, entry] of bySession) {
      if (!entry.allSettled || entry.albumIds.size === 0) continue;
      const target = getPendingSendTarget(sid);
      if (!target) continue;

      const candidateAlbumIds = [...entry.albumIds].filter((id) => !autoSentAlbumIds.has(id));
      if (candidateAlbumIds.length === 0) continue;

      try {
        const localRemote = await getTauriManagedRemote();
        if (!localRemote) continue;
        const client = await getClientForRemote(localRemote as unknown as CurrentRemoteInfo);
        const pendingResp = await client.music.listPendingImportReview({ session_id: sid });
        if (!pendingResp.success) {
          // couldn't confirm review status - try again next tick rather
          // than risk sending something that actually still needs review.
          continue;
        }
        const pendingAlbumIds = new Set(
          (pendingResp.data ?? []).flatMap((s) => s.albums.map((a) => a.album_id))
        );
        // only the albums that don't need review (exact re-imports of
        // already-known content, or metadata that resolved outright) get
        // auto-sent now - anything still pending stays untouched here and
        // gets picked up by the interactive review flow's own completion
        // effect once the user actually reviews it.
        const sendableAlbumIds = candidateAlbumIds.filter((id) => !pendingAlbumIds.has(id));
        if (sendableAlbumIds.length === 0) continue;

        const stillPendingAfterThis = [...entry.albumIds].some((id) => pendingAlbumIds.has(id));
        for (const id of sendableAlbumIds) autoSentAlbumIds.add(id);
        await sendReviewedAlbumsToRemote(
          sid,
          target.remoteId,
          target.remoteName,
          localRemote as unknown as Remote,
          sendableAlbumIds,
          undefined,
          stillPendingAfterThis
        );
        setReviewRefetchKey((k) => k + 1);
      } catch (e) {
        for (const id of candidateAlbumIds) autoSentAlbumIds.delete(id);
        debug("app", `auto-send for session ${sid} failed: ${String(e)}`);
      }
    }
  }

  // video ids already auto-sent by checkAutoSendForCompletedVideoSessions -
  // see autoSentAlbumIds above for why this is per-entity, not per-session.
  const autoSentVideoIds = new Set<string>();

  // video counterpart of checkAutoSendForCompletedSessions above - same bug
  // shape: a locally-imported video session where every file resolved as an
  // exact duplicate never gets a "review now" card (no pending groups), so
  // the interactive review-drain effect never runs and a registered
  // pendingSendTarget would otherwise never get acted on.
  async function checkAutoSendForCompletedVideoSessions() {
    const bySession = new Map<string, { videoIds: Set<string>; allSettled: boolean }>();
    for (const j of getVideoUploadJobs()) {
      if (!j.sessionId || !getPendingSendTarget(j.sessionId)) continue;
      let entry = bySession.get(j.sessionId);
      if (!entry) {
        entry = { videoIds: new Set(), allSettled: true };
        bySession.set(j.sessionId, entry);
      }
      if (j.videoId) entry.videoIds.add(j.videoId);
      if (j.status !== "completed" && j.status !== "failed") entry.allSettled = false;
    }

    for (const [sid, entry] of bySession) {
      if (!entry.allSettled || entry.videoIds.size === 0) continue;
      const target = getPendingSendTarget(sid);
      if (!target) continue;

      const candidateVideoIds = [...entry.videoIds].filter((id) => !autoSentVideoIds.has(id));
      if (candidateVideoIds.length === 0) continue;

      try {
        const localRemote = await getTauriManagedRemote();
        if (!localRemote) continue;
        const client = await getClientForRemote(localRemote as unknown as CurrentRemoteInfo);
        const pendingResp = await client.video.listPendingVideoImportReview({ session_id: sid });
        if (!pendingResp.success) {
          // couldn't confirm review status - try again next tick rather
          // than risk sending something that actually still needs review.
          continue;
        }
        const pendingVideoIds = new Set(
          (pendingResp.data ?? []).flatMap((s) =>
            s.groups.flatMap((g) => g.videos.map((v) => v.video_id))
          )
        );
        // only videos that don't need review get auto-sent now - anything
        // still pending stays untouched and gets picked up by the
        // interactive review flow's own completion effect once reviewed.
        const sendableVideoIds = candidateVideoIds.filter((id) => !pendingVideoIds.has(id));
        if (sendableVideoIds.length === 0) continue;

        const stillPendingAfterThis = [...entry.videoIds].some((id) => pendingVideoIds.has(id));
        for (const id of sendableVideoIds) autoSentVideoIds.add(id);
        await sendReviewedVideosToRemote(
          sid,
          target.remoteId,
          target.remoteName,
          localRemote as unknown as Remote,
          sendableVideoIds,
          undefined,
          stillPendingAfterThis
        );
        setReviewRefetchKey((k) => k + 1);
      } catch (e) {
        for (const id of candidateVideoIds) autoSentVideoIds.delete(id);
        debug("app", `video auto-send for session ${sid} failed: ${String(e)}`);
      }
    }
  }

  // callback for when any remote job completes — invalidate queries for new music
  const onRemoteJobComplete = () => {
    setHasSongs(true);
    setReviewRefetchKey((k) => k + 1);
    void checkAutoSendForCompletedSessions();
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return (
          key === "songs" ||
          key === "albums" ||
          key === "library-albums" ||
          key === "artists" ||
          key === "genres" ||
          key === "feed" ||
          key === "tags" ||
          // singular-prefixed keys (e.g. queryKeys.albums.songs() ->
          // ["album", "songs", ...], queryKeys.artists.albums() ->
          // ["artist", "albums", ...]). these aren't covered by the
          // plural keys above and would otherwise show stale data on
          // album/artist detail views right after an import.
          key === "album" ||
          key === "artist" ||
          key === "genre"
        );
      },
    });
  };

  const handleFilesSelected = async (files: FileList) => {
    const remote = addMediaTargetRemote();

    if (remote && isCharnelMode()) {
      // android (and any platform that can only produce `File` objects,
      // never real paths - see filePicker.ts) lands here instead of
      // handlePathsSelected, so it needs the same local-first redirect:
      // import into the local library, tag the session(s) with this
      // remote, and let the "review before send" flow send it once
      // reviewed. this used to OOM-crash the android webview because
      // CharnelLocalTransport buffered the whole file into one base64 IPC
      // payload - it now streams in bounded chunks instead (see
      // CharnelLocalTransport.uploadChunked), so this redirect is safe.
      const localRemote = await getTauriManagedRemote();
      if (!localRemote) {
        toast.error("local library isn't set up yet", { title: "import error" });
        return;
      }
      const targetId = remote.remote_id;
      const targetName = remote.name ?? "remote";
      await uploadFilesToRemote(
        files,
        onRemoteJobComplete,
        localRemote,
        (sessionId) =>
          setPendingSendTarget(sessionId, { remoteId: targetId, remoteName: targetName }),
        { remoteId: targetId, remoteName: targetName }
      );
      return;
    }

    // plain web (no charnel): every import - local-only or destined for a
    // remote - lands in the browser's own IndexedDB library first and goes
    // through the same review flow desktop/android get via grimoire (see
    // music/services/storage/db/importReview.ts). when a remote is
    // currently selected, tag the session so review finishes by sending
    // it there; otherwise it's a purely local import, same as before.
    try {
      const target = remote
        ? { remoteId: remote.remote_id, remoteName: remote.name ?? "remote" }
        : undefined;
      const result = await importMusicFiles(files, target);
      if (result.addedCount > 0) {
        setHasSongs(true);
        setReviewRefetchKey((k) => k + 1);
        queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey[0];
            return (
              key === "songs" ||
              key === "albums" ||
              key === "library-albums" ||
              key === "artists" ||
              key === "genres" ||
              key === "feed"
            );
          },
        });
      }
    } catch (error) {
      console.error("failed to process files:", error);
      toast.error("failed to import files", { title: "import error" });
    }
  };

  const handleUrlsSubmitted = async (urls: string[]) => {
    const remote = addMediaTargetRemote();

    if (!remote) {
      toast.warning("url downloads are only supported with a remote server", {
        title: "not supported",
      });
      return;
    }

    // fire-and-forget, jobs are tracked reactively
    await fetchUrlsOnRemote(urls, onRemoteJobComplete, remote);
  };

  // handle paths selected via tauri dialog (desktop only, Android uses file input)
  // supports local import (no remote), charnel-managed local remotes, and P2P remotes
  const handlePathsSelected = async (paths: string[]) => {
    const remote = addMediaTargetRemote();

    if (!remote) {
      // no remote selected yet (default "local library" state) - this
      // branch only ever runs in charnel/tauri (pickFiles only returns
      // real paths under Tauri; plain web always produces File objects and
      // goes through handleFilesSelected instead). previously this read
      // every file's full bytes via tauri-plugin-fs and rerouted through
      // handleFilesSelected's browser/OPFS importer - which actually
      // COPIED the file into OPFS storage instead of leaving it in place
      // on disk, and pointlessly buffered the bytes into the webview to
      // do it. hand the paths straight to grimoire's own path-based
      // import instead (server reads the file from its own path in place,
      // see import_music_paths / media_blobz.local_path) - exactly what
      // the "charnel-managed local remote" branch below already does once
      // a remote is explicitly selected; this is that same case before
      // any remote's been picked yet.
      try {
        const audioFilePaths = await expandPathsToAudioFiles(paths);
        const localRemote = await getTauriManagedRemote();
        if (!localRemote) {
          toast.error("local library isn't set up yet", { title: "import error" });
          return;
        }
        await importPathsToLocal(audioFilePaths, onRemoteJobComplete, undefined, localRemote);
      } catch (error) {
        console.error("failed to import paths:", error);
        toast.error("failed to start import", { title: "import error" });
      }
      return;
    }

    // P2P remote: import into the local library first (so metadata can be
    // reviewed/fixed), tag the session with this remote, and send it once
    // review completes - see the "review before send" add-media flow.
    // (import into local blobs store, then remote peer pulls via verified streaming)
    if (remote.peer_addr) {
      const audioFilePaths = await expandPathsToAudioFiles(paths);
      const localRemote = await getTauriManagedRemote();
      if (!localRemote) {
        toast.error("local library isn't set up yet", { title: "import error" });
        return;
      }
      const targetId = remote.remote_id;
      const targetName = remote.name ?? "remote";
      await importPathsToLocal(
        audioFilePaths,
        onRemoteJobComplete,
        (sessionId) =>
          setPendingSendTarget(sessionId, { remoteId: targetId, remoteName: targetName }),
        localRemote,
        { remoteId: targetId, remoteName: targetName }
      );
      return;
    }

    // charnel-managed local remote: send paths directly (server reads from disk)
    if (!remote.is_charnel_managed) {
      toast.warning("path-based import is only available for local or P2P remotes", {
        title: "not supported",
      });
      return;
    }

    // use importPathsToLocal which tracks each job with progress.
    // the add music modal shows a review card when the session finishes;
    // the user clicks it to open the review modal rather than auto-opening.
    try {
      const audioFilePaths = await expandPathsToAudioFiles(paths);
      await importPathsToLocal(audioFilePaths, onRemoteJobComplete, undefined, remote);
    } catch (error) {
      console.error("failed to import paths:", error);
      toast.error("failed to start import", { title: "import error" });
    }
  };

  const handleCloseAddMedia = () => {
    clearCompletedJobs();
    clearLocalImportProgress();
    clearLocalVideoImportProgress();
    clearCompletedVideoJobs();
    closeAddMedia();
  };

  // callback for when any remote video job completes — invalidate video queries
  const onRemoteVideoJobComplete = () => {
    setHasVideos(true);
    void checkAutoSendForCompletedVideoSessions();
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return key === "videos" || key === "video";
      },
      // refetch even queries with no active observer right now (e.g. the
      // videos view isn't mounted at the moment the upload finishes) - a
      // plain "active"-only refetch would just mark them stale and rely on
      // refetchOnMount, but useVideosQuery sets refetchOnMount: false, so
      // the grid/table would keep showing the pre-upload list until a full
      // reload.
      refetchType: "all",
    });
  };

  const handleVideoUrlsSubmitted = async (urls: string[]) => {
    const remote = addMediaTargetRemote();

    if (!remote) {
      toast.warning("url downloads are only supported with a remote server", {
        title: "not supported",
      });
      return;
    }

    // fire-and-forget, jobs are tracked reactively
    await fetchVideoUrlsOnRemote(urls, onRemoteVideoJobComplete, remote);
  };

  const handleVideoFilesSelected = async (files: FileList) => {
    const remote = addMediaTargetRemote();

    if (remote) {
      // remote upload: fire-and-forget, jobs are tracked reactively
      await uploadVideoFilesToRemote(Array.from(files), onRemoteVideoJobComplete, remote);
    } else {
      // local import: process files into OPFS/IndexedDB
      try {
        const result = await importVideoFiles(Array.from(files));
        if (result.errors.length > 0) {
          console.error("failed to import some video files:", result.errors);
        }
        if (result.imported > 0) {
          onRemoteVideoJobComplete();
        } else if (result.errors.length > 0) {
          toast.error("failed to import video files", { title: "import error" });
        }
      } catch (error) {
        console.error("failed to process video files:", error);
        toast.error("failed to import video files", { title: "import error" });
      }
    }
  };

  // handle video paths selected via tauri dialog (desktop only, Android uses file input)
  // supports local import (no remote), charnel-managed local remotes, and P2P remotes
  const handleVideoPathsSelected = async (paths: string[]) => {
    const remote = addMediaTargetRemote();

    if (!remote) {
      // no remote selected yet - same reasoning as handlePathsSelected's
      // matching branch above: hand the paths straight to grimoire's own
      // batch-paths import (server reads each file from its own path in
      // place, see import_video_paths / media_blobz.local_path) instead of
      // uploading paths one-by-one with no shared review session.
      try {
        const videoFilePaths = await expandPathsToVideoFiles(paths);
        const localRemote = await getTauriManagedRemote();
        if (!localRemote) {
          toast.error("local library isn't set up yet", { title: "import error" });
          return;
        }
        await importVideoPathsToLocal(
          videoFilePaths,
          onRemoteVideoJobComplete,
          undefined,
          localRemote
        );
      } catch (error) {
        console.error("failed to import local video paths:", error);
        toast.error("failed to start import", { title: "import error" });
      }
      return;
    }

    // P2P remote: import into the local library first (so metadata can be
    // reviewed/fixed), tag the session with this remote, and send it once
    // review completes - see handlePathsSelected's matching branch above,
    // now that sendVideoToRemote.ts exists (video's push-to-remote counterpart
    // to music's sendToRemote.ts).
    if (remote.peer_addr) {
      const videoFilePaths = await expandPathsToVideoFiles(paths);
      const localRemote = await getTauriManagedRemote();
      if (!localRemote) {
        toast.error("local library isn't set up yet", { title: "import error" });
        return;
      }
      const targetId = remote.remote_id;
      const targetName = remote.name ?? "remote";
      await importVideoPathsToLocal(
        videoFilePaths,
        onRemoteVideoJobComplete,
        (sessionId) =>
          setPendingSendTarget(sessionId, { remoteId: targetId, remoteName: targetName }),
        localRemote,
        { remoteId: targetId, remoteName: targetName }
      );
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
      const videoFilePaths = await expandPathsToVideoFiles(paths);
      await importVideoPathsToLocal(videoFilePaths, onRemoteVideoJobComplete, undefined, remote);
    } catch (error) {
      console.error("failed to import video paths:", error);
      toast.error("failed to start import", { title: "import error" });
    }
  };

  const handleSongDoubleClick = async (song: Song) => {
    // add song to end of queue and play it
    await addToQueue([song], { startPlaying: true, source: { type: "song", label: song.title } });
  };

  return (
    <>
      <TitleBarStrip />
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
          when={
            hasSongs() ||
            hasVideos() ||
            hasRemotes() ||
            isSettingsRoute() ||
            isRadioRoute() ||
            isSharedRoute()
          }
          fallback={
            <div class="h-screen flex items-center justify-center bg-[var(--color-bg-primary)]">
              <EmptyState
                onAddMedia={() => openAddMedia()}
                onAddRemote={() => setIsAddRemoteOpen(true)}
                onGoToRadio={() => {
                  window.location.hash = `/radio`;
                }}
              />
            </div>
          }
        >
          <HashRouter>
            {routes({
              onAddMedia: () => openAddMedia(),
              onSongDoubleClick: handleSongDoubleClick,
              onImportReview: (sid) => {
                openReviewSession(sid);
                handleCloseAddMedia();
              },
            })}
          </HashRouter>
        </Show>
      </Show>

      <AddMediaModal
        isOpen={isAddMediaOpen()}
        onClose={handleCloseAddMedia}
        onMusicFilesSelected={handleFilesSelected}
        onMusicPathsSelected={handlePathsSelected}
        onMusicUrlsSubmitted={handleUrlsSubmitted}
        onVideoFilesSelected={handleVideoFilesSelected}
        onVideoPathsSelected={handleVideoPathsSelected}
        onVideoUrlsSubmitted={handleVideoUrlsSubmitted}
        remoteName={addMediaTargetRemote()?.name}
        targetRemote={addMediaTargetRemote()}
        targetCandidates={addMediaCandidates().map((c) => c.remote)}
        onTargetChange={(remoteId) => setAddMediaTargetId(remoteId)}
        useCharnelDialog={isCharnelMode()}
        musicUploadJobs={getUploadJobs()}
        videoUploadJobs={getVideoUploadJobs()}
        localImportProgress={getLocalImportProgress()}
        videoLocalImportProgress={getLocalVideoImportProgress()}
        fetchPrecheckEnabled={fetchPrecheckEnabledQuery.data ?? false}
        fetchVideoEnabled={fetchVideoEnabledQuery.data ?? false}
        onReviewSession={(sid) => {
          openReviewSession(sid);
          handleCloseAddMedia();
        }}
        refetchReviewKey={reviewRefetchKey()}
        isAdmin={isAdmin()}
        dismissedReviewSessionId={completedReviewSessionId()}
        onReviewVideoSession={(sid) => {
          openReviewVideoSession(sid);
          handleCloseAddMedia();
        }}
        dismissedVideoReviewSessionId={completedVideoReviewSessionId()}
      />

      <Show when={useEditVideoState()()}>
        {(state) => (
          <EditVideoModal
            videoId={state().videoId}
            onClose={hideEditVideo}
            onSave={() => {
              state().onSave?.();
              hideEditVideo();
            }}
            onDeleted={state().onDeleted}
          />
        )}
      </Show>

      <Show when={useEditVideoSeriesState()()}>
        {(state) => (
          <EditVideoSeriesModal
            seriesId={state().seriesId}
            onClose={hideEditVideoSeries}
            onSave={() => {
              state().onSave?.();
              hideEditVideoSeries();
            }}
            onDeleted={state().onDeleted}
          />
        )}
      </Show>

      <Show when={useBulkEditVideosState()()}>
        {(state) => (
          <BulkEditVideosModal
            isOpen={true}
            videoIds={state().videoIds}
            onClose={hideBulkEditVideos}
            onSuccess={() => {
              state().onSuccess?.();
              hideBulkEditVideos();
            }}
          />
        )}
      </Show>

      <ImportReviewModal
        isOpen={reviewSessionId() !== null}
        loading={importReview.loading()}
        sendTargetName={importReview.targetRemoteName()}
        sendProgress={reviewSendProgress()}
        onClose={() => {
          // don't abandon an in-flight send - it keeps running in the
          // background regardless, but closing mid-send while still
          // rendering its own progress would be confusing to reopen into.
          const sending = reviewSendProgress();
          if (sending && !sending.done) return;
          const key = reviewTargetKey(reviewRemote(), "music");
          setReviewSessionId(null);
          setReviewRemote(null);
          dispatchImportSession(key, { type: "closed" });
          setReviewRefetchKey((k) => k + 1);
          // re-open the add media modal so the user can pick the next
          // pending review without having to open it manually
          openAddMedia();
        }}
        albums={importReview.albums()}
        onComplete={() => {
          // no-op: the createEffect watching albums().length === 0 (above)
          // is what actually completes the session and (if there's a
          // pending send target) drives the inline send progress - it fires
          // reliably once the server-side mark-reviewed call lands, whereas
          // this callback fires synchronously on click, before that.
        }}
        onMergeAlbums={(sourceIds: string[], targetId: string) =>
          void importReview.mergeAlbums(sourceIds, targetId)
        }
        onMoveSong={(songId: string, toAlbumId: string) =>
          void importReview.moveSong(songId, toAlbumId)
        }
        onCreateAlbumForSong={(songId: string, title: string, artistName: string | null) =>
          void importReview.moveSong(songId, null, title, artistName)
        }
        onMarkReviewed={async (albumId: string) => {
          // flush any pending edits from the editor before marking reviewed
          const saveFn = editorSaveFns.get(albumId);
          if (saveFn) {
            try {
              await saveFn();
            } catch {
              /* saveFn shows its own toast */
            }
          } else {
            // no editor registered (e.g. grouping stage) - just mark reviewed
            void importReview.markReviewed(albumId);
          }
        }}
        renderAlbumEditor={(editorProps) => {
          if (!reviewSessionId()) return <></>;
          return (
            <ImportReviewEditor
              {...editorProps}
              remote={reviewRemote()}
              reviewHandle={importReview}
              sessionId={reviewSessionId()!}
              onRegisterSave={(id, fn) => editorSaveFns.set(id, fn)}
              onUnregisterSave={(id) => editorSaveFns.delete(id)}
            />
          );
        }}
      />

      <ImportVideoReviewModal
        isOpen={reviewVideoSessionId() !== null}
        loading={videoImportReview.loading()}
        sendTargetName={videoImportReview.targetRemoteName()}
        sendProgress={reviewVideoSendProgress()}
        onClose={() => {
          // don't abandon an in-flight send - mirrors ImportReviewModal's
          // identical guard (music's equivalent).
          const sending = reviewVideoSendProgress();
          if (sending && !sending.done) return;
          dispatchImportSession(reviewTargetKey(reviewVideoRemote(), "video"), {
            type: "closed",
          });
          setReviewVideoSessionId(null);
          setReviewVideoRemote(null);
          setReviewRefetchKey((k) => k + 1);
          // re-open the add media modal so the user can pick the next
          // pending review without having to open it manually
          openAddMedia();
        }}
        groups={videoImportReview.groups()}
        onComplete={() => {
          // no-op: the createEffect watching groups().length === 0 (above)
          // is what actually completes the session and (if there's a
          // pending send target) drives the inline send progress - mirrors
          // ImportReviewModal's identical onComplete no-op/reasoning.
        }}
        onMoveVideo={(videoId: string, toSeriesId: string | null) =>
          void videoImportReview.moveVideo(videoId, toSeriesId)
        }
        onMarkReviewed={async (groupKey: string) => {
          // flush any pending edits from the editor before marking reviewed -
          // let a failure propagate so the modal doesn't advance past a
          // group that didn't actually save (its own inline error shows why).
          const saveFn = videoEditorSaveFns.get(groupKey);
          if (saveFn) {
            await saveFn();
          } else {
            // no editor registered (e.g. grouping stage) - just mark reviewed
            await videoImportReview.markReviewed(groupKey);
          }
        }}
        renderGroupEditor={(editorProps) => {
          if (!reviewVideoSessionId()) return <></>;
          return (
            <ImportVideoReviewEditor
              {...editorProps}
              reviewHandle={videoImportReview}
              onRegisterSave={(id, fn) => videoEditorSaveFns.set(id, fn)}
              onUnregisterSave={(id) => videoEditorSaveFns.delete(id)}
            />
          );
        }}
      />

      <AddRemoteModal
        isOpen={isAddRemoteOpen()}
        onClose={() => {
          setIsAddRemoteOpen(false);
          setAddRemoteInitialValue(undefined);
          setAddRemoteInitialIntent(undefined);
        }}
        completePeerAddr={autoCompletePeerAddr}
        onSuccess={(remote) => {
          debug("App", "remote added successfully:", remote.name);
          // show success toast
          toast.success(`connected to ${remote.name}`, {
            title: "remote added",
          });
          // add-media modal's target picker builds its list once at mount -
          // refresh it so the just-added remote shows up without a reload
          refreshCandidateDestinations(addMediaCandidates);
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
        initialIntent={addRemoteInitialIntent()}
      />

      <ResolveShareModal
        token={shareToken()}
        onClose={clearShareToken}
        onAddRemote={(nodeId) => {
          setAddRemoteInitialValue(nodeId);
          setIsAddRemoteOpen(true);
        }}
      />

      <RemotePickerModal />

      <Show when={useSongEditorState()()}>
        {(state) => (
          <SongEditorModal
            songId={state().songId}
            remote={state().remote}
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
            remote={state().remote}
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
            remote={state().remote}
            onClose={hideAlbumEditor}
            onSave={() => state().onSave?.()}
            disableNestedModals={state().disableNestedModals}
            onOpenSongEditor={(songId) => showSongEditor({ songId, disableNestedModals: true })}
            onMergeNavigate={state().onMergeNavigate}
            onDeleted={state().onDeleted}
            review={state().review}
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
            entityIds={state().entityIds}
            entityTitle={state().entityTitle}
            entityKindLabel={state().entityKindLabel}
            adapter={state().adapter}
            remote={state().remote}
            onClose={hideTagSelector}
            onSave={() => {
              state().onSave?.();
              hideTagSelector();
            }}
          />
        )}
      </Show>

      <Show when={useBulkReviewState()()}>
        {(state) => (
          <BulkEnrichmentReviewModal
            ids={state().ids}
            currentIndex={state().currentIndex}
            remote={state().remote}
            onNext={() => state().onNext()}
            onPrev={() => state().onPrev()}
            onExit={() => {
              // capture handler before flipping the parent state — once
              // hideBulkReview() runs the <Show> unmounts and `state()`
              // becomes stale (solid throws a warning + returns undef).
              const onExit = state().onExit;
              hideBulkReview();
              onExit();
            }}
            onMinimize={() => hideBulkReview()}
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
      <ReplaceQueueConfirmModal />
    </>
  );
}

export default App;

/**
 * expand a list of tauri-dialog-selected paths into audio file paths,
 * recursing into any directories (e.g. from the "select folder" picker).
 * a bare path may be a file or a directory, so each is probed with readDir
 * and falls back to being treated as a single file on failure. shared by
 * every `handlePathsSelected` branch (local, P2P remote, charnel-managed
 * remote) so directory-select works the same way regardless of remote type.
 */
async function expandPathsToAudioFiles(paths: string[]): Promise<string[]> {
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const fsModule = (await import("@tauri-apps/plugin-fs" as any)) as {
    readDir: (path: string) => Promise<{ name: string; isDirectory: boolean }[]>;
  };
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const pathModule = (await import("@tauri-apps/api/path" as any)) as {
    join: (...parts: string[]) => Promise<string>;
  };

  const audioFilePaths: string[] = [];
  const collectAudioFiles = async (path: string): Promise<void> => {
    let entries: { name: string; isDirectory: boolean }[] | null = null;
    try {
      entries = await fsModule.readDir(path);
    } catch {
      // not a directory - treat as a single file path
    }
    if (entries === null) {
      audioFilePaths.push(path);
      return;
    }
    for (const entry of entries) {
      const entryPath = await pathModule.join(path, entry.name);
      if (entry.isDirectory) {
        await collectAudioFiles(entryPath);
      } else {
        const ext = entry.name.split(".").pop()?.toLowerCase() || "";
        if (AUDIO_EXTS.includes(ext)) {
          audioFilePaths.push(entryPath);
        }
      }
    }
  };
  for (const path of paths) {
    await collectAudioFiles(path);
  }
  return audioFilePaths;
}

/**
 * expand a list of tauri-dialog-selected paths into video file paths.
 * mirrors `expandPathsToAudioFiles` above (same recursion into directories),
 * shared by every `handleVideoPathsSelected` branch.
 */
async function expandPathsToVideoFiles(paths: string[]): Promise<string[]> {
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const fsModule = (await import("@tauri-apps/plugin-fs" as any)) as {
    readDir: (path: string) => Promise<{ name: string; isDirectory: boolean }[]>;
  };
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const pathModule = (await import("@tauri-apps/api/path" as any)) as {
    join: (...parts: string[]) => Promise<string>;
  };

  const videoFilePaths: string[] = [];
  const collectVideoFiles = async (path: string): Promise<void> => {
    let entries: { name: string; isDirectory: boolean }[] | null = null;
    try {
      entries = await fsModule.readDir(path);
    } catch {
      // not a directory - treat as a single file path
    }
    if (entries === null) {
      videoFilePaths.push(path);
      return;
    }
    for (const entry of entries) {
      const entryPath = await pathModule.join(path, entry.name);
      if (entry.isDirectory) {
        await collectVideoFiles(entryPath);
      } else {
        const ext = entry.name.split(".").pop()?.toLowerCase() || "";
        if (VIDEO_EXTS.includes(ext)) {
          videoFilePaths.push(entryPath);
        }
      }
    }
  };
  for (const path of paths) {
    await collectVideoFiles(path);
  }
  return videoFilePaths;
}

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
