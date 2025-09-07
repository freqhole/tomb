import { HashRouter } from "@solidjs/router";
import { routes } from "./routes";
import { StoreProvider } from "./store";
import { SearchProvider } from "./context/SearchContext";

export default function Freqhole() {
  return (
    <StoreProvider>
      <SearchProvider>
        <HashRouter>{routes}</HashRouter>
      </SearchProvider>
    </StoreProvider>
  );
}
