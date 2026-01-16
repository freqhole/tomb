import { HashRouter } from "@solidjs/router";
import { routes } from "./routes";
import { StoreProvider } from "./store";
import { AuthProvider } from "./components/auth/AuthProvider";

export default function Freqhole() {
  return (
    <AuthProvider>
      <StoreProvider>
        <HashRouter>{routes}</HashRouter>
      </StoreProvider>
    </AuthProvider>
  );
}
