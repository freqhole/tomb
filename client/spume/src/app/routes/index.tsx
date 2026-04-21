import { Route, useNavigate, useParams } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, onMount, Show } from "solid-js";
import { whoami } from "../../app/services/remotes/authService";
import { useLocalSource, getCurrentRemote } from "../../music/data";
import {
  getActiveRemote,
  getRemoteById,
  getTauriManagedRemote,
  isP2PTransport,
} from "../../app/services/remotes/remoteManager";
import { connectToRemote } from "../../app/services/remotes/connectionProgress";
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
import { AggregateFeedView } from "../../music/views/AggregateFeedView";
import { GenresView } from "../../music/views/GenresView";
import { PlaylistsView } from "../../music/views/PlaylistsView";
import { SongsView } from "../../music/views/SongsView";
import { AppLayout } from "../AppLayout";
import {
  SettingsLayout,
  StorageSettingsView,
  RemotesSettingsView,
  FederationSettingsView,
  RemoteAdminView,
} from "../../settings";
import { isCharnelMode } from "../services/charnel";
import { getDefaultRoute } from "../../music/utils/routing";
import { debug } from "../../utils/logger";

interface RoutesProps {
  onAddMusic: () => void;
  onSongDoubleClick: (song: any) => void;
}

function RootRedirect() {
  const navigate = useNavigate();

  onMount(async () => {
    // in tauri mode, always start with the tauri-managed remote
    // (don't try to reconnect to a stored P2P remote that might be offline)
    if (isCharnelMode()) {
      const tauriRemote = await getTauriManagedRemote();
      if (tauriRemote) {
        debug("routes", "tauri mode: navigating to tauri-managed remote");
        navigate(getDefaultRoute(tauriRemote.remote_id), { replace: true });
        return;
      }
      // no tauri remote yet - stay on root (App.tsx will handle setup)
      debug("routes", "tauri mode: no tauri remote yet, waiting...");
      return;
    }

    // non-tauri mode: check if there's an active remote in IndexedDB
    const activeRemote = await getActiveRemote();

    if (activeRemote) {
      // navigate to that remote's route - RemoteContextHandler will handle connection
      debug("routes", `navigating to stored active remote: ${activeRemote.name}`);
      navigate(getDefaultRoute(activeRemote.remote_id), { replace: true });
    } else {
      // no active remote, go to local
      debug("routes", "no active remote, navigating to local");
      navigate(getDefaultRoute("local"), { replace: true });
    }
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
        <Route path="/remotes/:remoteId/admin" component={RemoteAdminView} />
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

        {/* aggregate feed - combines all remotes */}
        <Route path="/feed" component={AggregateFeedView} />

        {/* local context routes - hidden in tauri mode (always uses remote server) */}
        {!isCharnelMode() && (
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

  // track connection state - only render children when connected
  const [isConnected, setIsConnected] = createSignal(false);

  // track the resolved remote info for auth flow
  const [remoteInfo, setRemoteInfo] = createSignal<{
    remote_id: string;
    name: string;
    base_url?: string; // undefined for P2P remotes
    peer_addr?: string; // for P2P remotes
    is_charnel_managed?: boolean;
  } | null>(null);

  // re-auth modal state
  const [showReauthModal, setShowReauthModal] = createSignal(false);
  // track the toast id so we can dismiss it after re-auth
  let authToastId: number | null = null;

  // navigate to fallback: stay on current remote if available, otherwise local
  const goToFallback = async (targetRemoteId: string) => {
    const current = getCurrentRemote();
    if (current && current.remote_id !== targetRemoteId) {
      // stay where we were (different remote that's already active)
      debug("routes", `fallback: staying on current remote ${current.name}`);
      navigate(getDefaultRoute(current.remote_id), { replace: true });
    } else if (isCharnelMode()) {
      // in tauri, try tauri-managed remote
      const tauriRemote = await getTauriManagedRemote();
      if (tauriRemote && tauriRemote.remote_id !== targetRemoteId) {
        debug("routes", `fallback: going to tauri remote ${tauriRemote.name}`);
        navigate(getDefaultRoute(tauriRemote.remote_id), { replace: true });
      }
      // else stay on current route (tauri will eventually set up remote)
    } else {
      // web mode: fall back to local
      debug("routes", "fallback: going to local");
      await useLocalSource();
      navigate(getDefaultRoute("local"), { replace: true });
    }
  };

  onMount(async () => {
    const remoteId = params.remoteId;
    if (!remoteId) return;

    const remote = await getRemoteById(remoteId);
    if (!remote) {
      console.warn(`remote not found: ${remoteId}`);
      await goToFallback(remoteId);
      return;
    }

    // for HTTP remotes that are offline, redirect immediately
    if (!isP2PTransport(remote) && remote.is_offline) {
      debug("routes", `remote ${remote.name} is offline, redirecting to fallback`);
      toast.error(`${remote.name} is offline`);
      await goToFallback(remoteId);
      return;
    }

    // attempt connection with progress modal support
    // this handles health check, data source switching, and cancellation
    const result = await connectToRemote(remoteId);

    if (result.cancelled) {
      debug("routes", `connection to ${remote.name} cancelled by user`);
      await goToFallback(remoteId);
      return;
    }

    if (!result.success) {
      debug("routes", `failed to connect to ${remote.name}`);
      toast.error(`cannot reach ${remote.name}`);
      await goToFallback(remoteId);
      return;
    }

    // connection successful - set remote info for auth flow
    setRemoteInfo({
      remote_id: remote.remote_id,
      name: remote.name,
      base_url: isHttpRemote(remote) ? remote.base_url : undefined,
      peer_addr: isP2PRemote(remote) ? remote.peer_addr : undefined,
      is_charnel_managed: remote.is_charnel_managed,
    });
    setIsConnected(true);
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
    if (info.is_charnel_managed) {
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
      authToastId = toast.custom(
        (toastProps) => (
          <AuthExpiredToast
            toastId={toastProps.toastId}
            remoteName={info.name}
            onSignIn={() => setShowReauthModal(true)}
          />
        ),
        { key: "auth-expired", message: "" }
      );
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
      {/* only render children when connected - prevents showing stale data */}
      <Show when={isConnected()}>{props.children}</Show>
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
