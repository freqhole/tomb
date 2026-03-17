import { Route, useNavigate, useParams } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, onMount, Show } from "solid-js";
import { whoami } from "../../app/services/remotes/authService";
import { useLocalSource, useRemoteSource, getCurrentRemote } from "../../music/data";
import {
  getActiveRemote,
  getRemoteById,
  getTauriManagedRemote,
  checkRemoteHealth,
  isP2PTransport,
} from "../../app/services/remotes/remoteManager";
import { isHttpRemote, isP2PRemote } from "../../app/services/storage/types";
import { getRemoteNeedsAuth, clearRemoteNeedsAuth } from "../../music/data/remote/authState";
import { AuthExpiredToast } from "../../components/auth/AuthExpiredToast";
import { ReauthModal } from "../../components/auth/ReauthModal";
import { toast } from "../../components/feedback/Toast";
import { AlbumDetailView } from "../../music/views/AlbumDetailView";
import { AlbumsView } from "../../music/views/AlbumsView";
import { ArtistsView } from "../../music/views/ArtistsView";
import { FavoritesView } from "../../music/views/FavoritesView";
import { FeedView } from "../../music/views/FeedView";
import { GenresView } from "../../music/views/GenresView";
import { PlaylistsView } from "../../music/views/PlaylistsView";
import { SongsView } from "../../music/views/SongsView";
import { AppLayout } from "../AppLayout";
import {
  SettingsLayout,
  StorageSettingsView,
  RemotesSettingsView,
  FederationSettingsView,
} from "../../settings";
import { isTauriMode } from "../services/tauri";
import { debug } from "../../utils/logger";

interface RoutesProps {
  onAddMusic: () => void;
  onSongDoubleClick: (song: any) => void;
}

function RootRedirect() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  onMount(async () => {
    // tauri remote setup is now done in App.tsx before initializeDataSource()
    // here we just need to redirect to the appropriate route

    // if already have an active remote from initialization, navigate to it
    const currentRemote = getCurrentRemote();
    if (currentRemote) {
      debug("routes", "current remote from init:", currentRemote.name);
      navigate(`/${currentRemote.remote_id}/feed`, { replace: true });
      return;
    }

    // fallback: check if there's an active remote in IndexedDB
    const activeRemote = await getActiveRemote();
    // allow P2P remotes to try even if marked offline
    const canTryActive = activeRemote && (!activeRemote.is_offline || isP2PTransport(activeRemote));

    if (canTryActive) {
      // switch to that remote and navigate to its route
      await useRemoteSource(activeRemote);
      queryClient.invalidateQueries();
      navigate(`/${activeRemote.remote_id}/feed`, { replace: true });
    } else if (!isTauriMode()) {
      // no active remote, use local (skip in tauri mode - wait for server)
      await useLocalSource();
      queryClient.invalidateQueries();
      navigate("/local/songs", { replace: true });
    }
    // in tauri mode with no active remote, stay on root and wait for server
  });

  return null;
}

export function routes(props: RoutesProps) {
  return (
    <>
      {/* settings routes - outside AppLayout */}
      <Route path="/settings" component={(p) => <SettingsLayout>{p.children}</SettingsLayout>}>
        <Route path="/storage" component={StorageSettingsView} />
        <Route path="/remotes" component={RemotesSettingsView} />
        <Route path="/federation" component={FederationSettingsView} />
        {/* redirect /settings to /settings/storage */}
        <Route
          path="/"
          component={() => {
            const navigate = useNavigate();
            onMount(() => navigate("/settings/storage", { replace: true }));
            return null;
          }}
        />
      </Route>

      <Route path="/" component={AppLayout}>
        {/* root redirect - goes to last active remote or local */}
        <Route path="/" component={RootRedirect} />

        {/* local context routes - hidden in tauri mode (always uses remote server) */}
        {!isTauriMode() && (
          <Route path="/local" component={LocalContextHandler}>
            <Route path="/feed" component={FeedView} />
            <Route
              path="/songs"
              component={() => (
                <SongsView
                  onAddMusic={props.onAddMusic}
                  onSongDoubleClick={props.onSongDoubleClick}
                />
              )}
            />
            <Route path="/albums" component={() => <AlbumsView onAddMusic={props.onAddMusic} />} />
            <Route path="/albums/:id" component={AlbumDetailView} />
            <Route
              path="/artists/:id?"
              component={() => (
                <ArtistsView
                  onAddMusic={props.onAddMusic}
                  onArtistClick={(artistId) => debug("routes", "artist clicked:", artistId)}
                />
              )}
            />
            <Route path="/genres" component={() => <GenresView onAddMusic={props.onAddMusic} />} />
            <Route
              path="/playlists/:id?"
              component={() => <PlaylistsView onAddMusic={props.onAddMusic} />}
            />
            <Route
              path="/favorites"
              component={() => (
                <FavoritesView
                  onAddMusic={props.onAddMusic}
                  onSongDoubleClick={props.onSongDoubleClick}
                />
              )}
            />
          </Route>
        )}

        {/* remote context routes */}
        <Route path="/:remoteId" component={RemoteContextHandler}>
          <Route path="/feed" component={FeedView} />
          <Route
            path="/songs"
            component={() => (
              <SongsView
                onAddMusic={props.onAddMusic}
                onSongDoubleClick={props.onSongDoubleClick}
              />
            )}
          />
          <Route path="/albums" component={() => <AlbumsView onAddMusic={props.onAddMusic} />} />
          <Route path="/albums/:id" component={AlbumDetailView} />
          <Route
            path="/artists/:id?"
            component={() => (
              <ArtistsView
                onAddMusic={props.onAddMusic}
                onArtistClick={(artistId) => debug("routes", "artist clicked:", artistId)}
              />
            )}
          />
          <Route
            path="/genres/:genreId?"
            component={() => <GenresView onAddMusic={props.onAddMusic} />}
          />
          <Route
            path="/playlists/:id?"
            component={() => <PlaylistsView onAddMusic={props.onAddMusic} />}
          />
          <Route
            path="/favorites"
            component={() => (
              <FavoritesView
                onAddMusic={props.onAddMusic}
                onSongDoubleClick={props.onSongDoubleClick}
              />
            )}
          />
        </Route>
      </Route>
    </>
  );
}

// handler for local context routes - ensures we're using local data source
function LocalContextHandler(props: { children?: any }) {
  const queryClient = useQueryClient();

  onMount(async () => {
    await useLocalSource();
    queryClient.invalidateQueries();
  });

  return <>{props.children}</>;
}

// handler for remote context routes - ensures we're using the correct remote
// also watches for auth expiry and prompts re-authentication
function RemoteContextHandler(props: { children?: any }) {
  const params = useParams<{ remoteId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // track the resolved remote info for auth flow
  const [remoteInfo, setRemoteInfo] = createSignal<{
    remote_id: string;
    name: string;
    base_url?: string; // undefined for P2P remotes
    peer_addr?: string; // for P2P remotes
    is_tauri_managed?: boolean;
  } | null>(null);

  // re-auth modal state
  const [showReauthModal, setShowReauthModal] = createSignal(false);
  // track the toast id so we can dismiss it after re-auth
  let authToastId: number | null = null;

  onMount(async () => {
    const remoteId = params.remoteId;
    if (!remoteId) return;

    const remote = await getRemoteById(remoteId);
    if (!remote) {
      console.warn(`remote not found: ${remoteId}`);
      return;
    }

    // for P2P remotes, always try to connect (even if marked offline)
    // because the midden node may not have been initialized when offline was set
    const shouldTryConnect = isP2PTransport(remote) || !remote.is_offline;

    if (!shouldTryConnect) {
      debug("routes", `remote ${remote.name} is offline, redirecting to fallback`);
      toast.error(`${remote.name} is offline`);

      if (isTauriMode()) {
        // in tauri mode, try to use tauri-managed remote
        const tauriRemote = await getTauriManagedRemote();
        if (tauriRemote && tauriRemote.remote_id !== remoteId && !tauriRemote.is_offline) {
          navigate(`/${tauriRemote.remote_id}/feed`, { replace: true });
          return;
        }
      }
      // fallback to local
      await useLocalSource();
      navigate("/local/songs", { replace: true });
      return;
    }

    // for P2P remotes that were offline, do a fresh health check first
    if (isP2PTransport(remote) && remote.is_offline) {
      debug("routes", `P2P remote ${remote.name} was offline, trying fresh connection...`);
      const isOnline = await checkRemoteHealth(remote);
      if (!isOnline) {
        debug("routes", `P2P remote ${remote.name} still not reachable`);
        toast.error(`cannot reach ${remote.name}`);
        if (!isTauriMode()) {
          await useLocalSource();
          navigate("/local/songs", { replace: true });
        }
        return;
      }
      debug("routes", `P2P remote ${remote.name} is now online`);
    }

    setRemoteInfo({
      remote_id: remote.remote_id,
      name: remote.name,
      base_url: isHttpRemote(remote) ? remote.base_url : undefined,
      peer_addr: isP2PRemote(remote) ? remote.peer_addr : undefined,
      is_tauri_managed: remote.is_tauri_managed,
    });
    await useRemoteSource(remote);
    queryClient.invalidateQueries();
  });

  // watch for auth expiry on this remote
  createEffect(async () => {
    const info = remoteInfo();
    if (!info) return;

    const needsAuth = getRemoteNeedsAuth(info.remote_id);
    if (!needsAuth) return;

    // for the tauri-managed sidecar remote, auth refresh is handled automatically
    // by rust pushing a fresh invite code - no need to show the toast
    if (info.is_tauri_managed) {
      return;
    }

    // P2P remotes don't use HTTP auth - don't show auth toast
    if (info.peer_addr && !info.base_url) {
      return;
    }

    // confirm it's actually an auth issue (not just server being down)
    try {
      if (!info.base_url) return; // no base_url means P2P remote
      const whoamiResult = await whoami(info.base_url);
      if (whoamiResult.success) {
        // session is actually valid — clear the flag (false alarm)
        clearRemoteNeedsAuth(info.remote_id);
        return;
      }
    } catch {
      // network error — server might be down, don't show auth toast
      return;
    }

    // confirmed auth expiry — show persistent toast
    if (authToastId === null) {
      authToastId = toast.custom((toastProps) => (
        <AuthExpiredToast
          toastId={toastProps.toastId}
          remoteName={info.name}
          onSignIn={() => setShowReauthModal(true)}
        />
      ));
    }
  });

  const handleReauthSuccess = () => {
    const info = remoteInfo();
    if (info) {
      clearRemoteNeedsAuth(info.remote_id);
    }
    setShowReauthModal(false);

    // dismiss the auth toast
    if (authToastId !== null) {
      toast.dismiss(authToastId);
      authToastId = null;
    }

    // re-fetch data now that we're authenticated
    queryClient.invalidateQueries();
  };

  return (
    <>
      {props.children}
      <Show when={remoteInfo()}>
        {(info) => (
          <ReauthModal
            isOpen={showReauthModal()}
            onClose={() => setShowReauthModal(false)}
            onSuccess={handleReauthSuccess}
            baseUrl={info().base_url ?? ""}
            remoteName={info().name}
          />
        )}
      </Show>
    </>
  );
}
