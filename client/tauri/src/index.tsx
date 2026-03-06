/* @refresh reload */
import { render } from "solid-js/web";
import { HashRouter, Route } from "@solidjs/router";
import App from "./App";
import SetupView from "./views/SetupView";
import LogsView from "./views/LogsView";
import LibraryView from "./views/LibraryView";
import UsersView from "./views/UsersView";
import SettingsView from "./views/SettingsView";
import FederationView from "./views/FederationView";

render(
  () => (
    <HashRouter root={App}>
      <Route path="/" component={SetupView} />
      <Route path="/setup" component={SetupView} />
      <Route path="/logs" component={LogsView} />
      <Route path="/library" component={LibraryView} />
      <Route path="/users" component={UsersView} />
      <Route path="/settings" component={SettingsView} />
      <Route path="/federation" component={FederationView} />
    </HashRouter>
  ),
  document.getElementById("root") as HTMLElement,
);
