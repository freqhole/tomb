import { Route } from "@solidjs/router";
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

export function routes(props: RoutesProps) {
  return (
    <Route path="/" component={AppLayout}>
      <Route
        path="/"
        component={() => (
          <SongsView
            onAddMusic={props.onAddMusic}
            onSongDoubleClick={props.onSongDoubleClick}
          />
        )}
      />
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
        path="/playlists"
        component={() => <PlaylistsView onAddMusic={props.onAddMusic} />}
      />
      <Route path="/playlists/:id" component={PlaylistDetailView} />
    </Route>
  );
}
