import { Route } from "@solidjs/router";
import { ThreeColumnLayout } from "../components/layout/ThreeColumnLayout";
import { SongTableView } from "../components/content/views/SongTableView";
import { ArtistSplitView } from "../components/content/views/ArtistSplitView";
import { AlbumGridView } from "../components/content/views/AlbumGridView";
import { GenreSplitView } from "../components/content/views/GenreSplitView";
import { PlaylistDetailView } from "../components/content/views/PlaylistDetailView";
import { SearchResultsView } from "../components/content/views/SearchResultsView";
import { ArtistDetailView } from "../components/content/views/ArtistDetailView";
import { AlbumDetailView } from "../components/content/views/AlbumDetailView";

export const routes = (
  <Route path="/" component={ThreeColumnLayout}>
    <Route path="/" component={GenreSplitView} />
    <Route path="/songs" component={SongTableView} />

    <Route
      path="/song/:id"
      component={() => <div class="p-4 text-white">song detail view</div>}
    />
    <Route path="/artists" component={ArtistSplitView} />
    <Route path="/artist/:id" component={ArtistDetailView} />
    <Route path="/albums" component={AlbumGridView} />
    <Route path="/genres" component={GenreSplitView} />
    <Route
      path="/genre/:id"
      component={() => <div class="p-4 text-white">standalone genre view</div>}
    />
    <Route path="/album/:artist/:album" component={AlbumDetailView} />
    <Route path="/album/:id" component={AlbumDetailView} />
    <Route path="/playlists" component={PlaylistDetailView} />
    <Route path="/playlists/new" component={PlaylistDetailView} />
    <Route path="/playlist/:id" component={PlaylistDetailView} />
    <Route path="/search" component={SearchResultsView} />
  </Route>
);
