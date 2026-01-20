import { Route, useNavigate, useParams } from "@solidjs/router";
import { useQueryClient } from "@tanstack/solid-query";
import { onMount } from "solid-js";
import { useLocalSource, useRemoteSource } from "../../music/data";
import {
  getActiveRemote,
  getRemoteById,
} from "../../music/services/remotes/remoteManager";
import { AlbumDetailView } from "../../music/views/AlbumDetailView";
import { AlbumsView } from "../../music/views/AlbumsView";
import { ArtistDetailView } from "../../music/views/ArtistDetailView";
import { ArtistsView } from "../../music/views/ArtistsView";
import { GenresView } from "../../music/views/GenresView";
import { PlaylistDetailView } from "../../music/views/PlaylistDetailView";
import { PlaylistsView } from "../../music/views/PlaylistsView";
import { SongsView } from "../../music/views/SongsView";
import { AppLayout } from "../AppLayout";

interface RoutesProps {
  onAddMusic: () => void;
  onSongDoubleClick: (song: any) => void;
}

function RootRedirect() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  onMount(async () => {
    // check if there's an active remote in IndexedDB
    const activeRemote = await getActiveRemote();

    if (activeRemote) {
      // switch to that remote and navigate to its route
      await useRemoteSource(
        activeRemote.remote_id,
        activeRemote.name,
        activeRemote.base_url,
      );
      queryClient.invalidateQueries();
      navigate(`/${activeRemote.remote_id}/songs`, { replace: true });
    } else {
      // no active remote, use local
      await useLocalSource();
      queryClient.invalidateQueries();
      navigate("/local/songs", { replace: true });
    }
  });

  return null;
}

export function routes(props: RoutesProps) {
  return (
    <Route path="/" component={AppLayout}>
      {/* root redirect - goes to last active remote or local */}
      <Route path="/" component={RootRedirect} />

      {/* local context routes */}
      <Route path="/local" component={LocalContextHandler}>
        <Route
          path="/songs"
          component={() => (
            <SongsView
              onAddMusic={props.onAddMusic}
              onSongDoubleClick={props.onSongDoubleClick}
            />
          )}
        />
        <Route
          path="/albums"
          component={() => <AlbumsView onAddMusic={props.onAddMusic} />}
        />
        <Route path="/albums/:id" component={AlbumDetailView} />
        <Route
          path="/artists"
          component={() => (
            <ArtistsView
              onAddMusic={props.onAddMusic}
              onArtistClick={(artistId) =>
                console.log("artist clicked:", artistId)
              }
            />
          )}
        />
        <Route path="/artists/:id" component={ArtistDetailView} />
        <Route
          path="/genres"
          component={() => <GenresView onAddMusic={props.onAddMusic} />}
        />
        <Route
          path="/playlists/:id?"
          component={() => <PlaylistsView onAddMusic={props.onAddMusic} />}
        />
        <Route path="/playlist/:id" component={PlaylistDetailView} />
      </Route>

      {/* remote context routes */}
      <Route path="/:remoteId" component={RemoteContextHandler}>
        <Route
          path="/songs"
          component={() => (
            <SongsView
              onAddMusic={props.onAddMusic}
              onSongDoubleClick={props.onSongDoubleClick}
            />
          )}
        />
        <Route
          path="/albums"
          component={() => <AlbumsView onAddMusic={props.onAddMusic} />}
        />
        <Route path="/albums/:id" component={AlbumDetailView} />
        <Route
          path="/artists"
          component={() => (
            <ArtistsView
              onAddMusic={props.onAddMusic}
              onArtistClick={(artistId) =>
                console.log("artist clicked:", artistId)
              }
            />
          )}
        />
        <Route path="/artists/:id" component={ArtistDetailView} />
        <Route
          path="/genres"
          component={() => <GenresView onAddMusic={props.onAddMusic} />}
        />
        <Route
          path="/playlists/:id?"
          component={() => <PlaylistsView onAddMusic={props.onAddMusic} />}
        />
        <Route path="/playlist/:id" component={PlaylistDetailView} />
      </Route>
    </Route>
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
function RemoteContextHandler(props: { children?: any }) {
  const params = useParams<{ remoteId: string }>();
  const queryClient = useQueryClient();

  onMount(async () => {
    const remoteId = params.remoteId;
    if (!remoteId) return;

    const remote = await getRemoteById(remoteId);
    if (remote) {
      await useRemoteSource(remote.remote_id, remote.name, remote.base_url);
      queryClient.invalidateQueries();
    } else {
      console.warn(`remote not found: ${remoteId}`);
    }
  });

  return <>{props.children}</>;
}
