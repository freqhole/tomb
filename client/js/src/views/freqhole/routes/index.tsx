import { Route } from "@solidjs/router";
import { ThreeColumnLayout } from "../components/layout/ThreeColumnLayout";
import { SongTableView } from "../components/content/views/SongTableView";
import { ArtistSplitView } from "../components/content/views/ArtistSplitView";
import { AlbumGridView } from "../components/content/views/AlbumGridView";
import { PlaylistDetailView } from "../components/content/views/PlaylistDetailView";
import { SearchResultsView } from "../components/content/views/SearchResultsView";
import { ArtistDetailView } from "../components/content/views/ArtistDetailView";

export const routes = (
  <Route path="/" component={ThreeColumnLayout}>
    <Route path="/" component={SongTableView} />
    <Route path="/songs" component={SongTableView} />
    <Route
      path="/song/:id"
      component={() => <div class="p-4 text-white">song detail view</div>}
    />
    <Route path="/artists" component={ArtistSplitView} />
    <Route path="/artist/:id" component={ArtistDetailView} />
    <Route path="/albums" component={AlbumGridView} />
    <Route
      path="/album/:id"
      component={() => <div class="p-4 text-white">album detail view</div>}
    />
    <Route path="/playlists" component={PlaylistDetailView} />
    <Route path="/playlists/new" component={PlaylistDetailView} />
    <Route path="/playlist/:id" component={PlaylistDetailView} />
    <Route path="/search" component={SearchResultsView} />
  </Route>
);
