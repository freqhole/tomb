import { Route, useNavigate, useParams } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, onMount, Show } from "solid-js";
import { whoami } from "../../app/services/remotes/authService";
import { useLocalSource, useRemoteSource, getCurrentRemote } from "../../music/data";
import { getActiveRemote, getRemoteById } from "../../app/services/remotes/remoteManager";
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
import { SettingsLayout, StorageSettingsView, RemotesSettingsView } from "../../settings";
import { getSavedRoute } from "../../utils/tauri/routePersistence";
import { debug } from "../../utils/logger";
import { isTauriMode } from "../../utils/tauri";

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
      navigate(`/${currentRemote.remote_id}/songs`, { replace: true });
      return;
    }

    // check for saved route from previous tauri session
    const savedRoute = getSavedRoute();
    if (savedRoute) {
      // extract remote ID from route if present (e.g., "/abc123/songs" -> "abc123")
      const match = savedRoute.match(/^\/([^\/]+)/);
      const routeContext = match?.[1];

      if (routeContext && routeContext !== "local" && routeContext !== "settings") {
        // try to restore remote context
        const remote = await getRemoteById(routeContext);
        if (remote) {
          await useRemoteSource(remote.remote_id, remote.name, remote.base_url, remote.api_key);
          queryClient.invalidateQueries();
          navigate(savedRoute, { replace: true });
          return;
        }
      } else if (routeContext === "local" && !isTauriMode()) {
        // skip local route restoration in tauri mode
        await useLocalSource();
        queryClient.invalidateQueries();
        navigate(savedRoute, { replace: true });
        return;
      }
    }

    // fallback: check if there's an active remote in IndexedDB
    const activeRemote = await getActiveRemote();

    if (activeRemote) {
      // switch to that remote and navigate to its route
      await useRemoteSource(
        activeRemote.remote_id,
        activeRemote.name,
        activeRemote.base_url,
        activeRemote.api_key
      );
      queryClient.invalidateQueries();
      navigate(`/${activeRemote.remote_id}/songs`, { replace: true });
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
  const queryClient = useQueryClient();

  // track the resolved remote info for auth flow
  const [remoteInfo, setRemoteInfo] = createSignal<{
    remote_id: string;
    name: string;
    base_url: string;
  } | null>(null);

  // re-auth modal state
  const [showReauthModal, setShowReauthModal] = createSignal(false);
  // track the toast id so we can dismiss it after re-auth
  let authToastId: number | null = null;

  onMount(async () => {
    const remoteId = params.remoteId;
    if (!remoteId) return;

    const remote = await getRemoteById(remoteId);
    if (remote) {
      setRemoteInfo({ remote_id: remote.remote_id, name: remote.name, base_url: remote.base_url });
      await useRemoteSource(remote.remote_id, remote.name, remote.base_url, remote.api_key);
      queryClient.invalidateQueries();
    } else {
      console.warn(`remote not found: ${remoteId}`);
    }
  });

  // watch for auth expiry on this remote
  createEffect(async () => {
    const info = remoteInfo();
    if (!info) return;

    const needsAuth = getRemoteNeedsAuth(info.remote_id);
    if (!needsAuth) return;

    // confirm it's actually an auth issue (not just server being down)
    try {
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
            baseUrl={info().base_url}
            remoteName={info().name}
          />
        )}
      </Show>
    </>
  );
}
