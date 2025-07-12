import { Route } from "@solidjs/router";
import { ThreeColumnLayout } from "../components/layout/ThreeColumnLayout";

export const routes = (
  <Route path="/" component={ThreeColumnLayout}>
    <Route path="/" component={() => <div class="p-4 text-white">songs view (default)</div>} />
    <Route path="/songs" component={() => <div class="p-4 text-white">songs view</div>} />
    <Route path="/song/:id" component={() => <div class="p-4 text-white">song detail view</div>} />
    <Route path="/artists" component={() => <div class="p-4 text-white">artists view</div>} />
    <Route path="/artist/:id" component={() => <div class="p-4 text-white">artist detail view</div>} />
    <Route path="/albums" component={() => <div class="p-4 text-white">albums view</div>} />
    <Route path="/album/:id" component={() => <div class="p-4 text-white">album detail view</div>} />
    <Route path="/playlists" component={() => <div class="p-4 text-white">all playlists view</div>} />
    <Route path="/playlist/:id" component={() => <div class="p-4 text-white">playlist detail view</div>} />
    <Route path="/search" component={() => <div class="p-4 text-white">search results view</div>} />
  </Route>
);
