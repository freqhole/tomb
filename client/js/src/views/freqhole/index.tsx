import { HashRouter } from "@solidjs/router";
import { routes } from "./routes";
import { StoreProvider } from "./store";
import { SearchProvider } from "./context/SearchContext";
import { AuthProvider } from "./components/auth/AuthProvider";

export default function Freqhole() {
  return (
    <AuthProvider>
      <StoreProvider>
        <SearchProvider>
          <HashRouter>{routes}</HashRouter>
        </SearchProvider>
      </StoreProvider>
    </AuthProvider>
  );
}
