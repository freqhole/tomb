import { Route } from "@solidjs/router";
import { AlbumsView } from "../../music/views/AlbumsView";
import { ArtistsView } from "../../music/views/ArtistsView";
import { GenresView } from "../../music/views/GenresView";
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
        component={() => <SongsView onAddMusic={props.onAddMusic} onSongDoubleClick={props.onSongDoubleClick} />}
      />
      <Route
        path="/songs"
        component={() => <SongsView onAddMusic={props.onAddMusic} onSongDoubleClick={props.onSongDoubleClick} />}
      />
      <Route
        path="/albums"
        component={() => (
          <AlbumsView
            onAddMusic={props.onAddMusic}
            onAlbumClick={(albumId) => console.log("album clicked:", albumId)}
          />
        )}
      />
      <Route
        path="/artists"
        component={() => (
          <ArtistsView
            onAddMusic={props.onAddMusic}
            onArtistClick={(artistId) => console.log("artist clicked:", artistId)}
          />
        )}
      />
      <Route
        path="/genres"
        component={() => (
          <GenresView
            onAddMusic={props.onAddMusic}
            onGenreClick={(genreId) => console.log("genre clicked:", genreId)}
          />
        )}
      />
      <Route
        path="/playlists"
        component={() => (
          <PlaylistsView
            onAddMusic={props.onAddMusic}
            onPlaylistClick={(playlistId) => console.log("playlist clicked:", playlistId)}
          />
        )}
      />
    </Route>
  );
}
