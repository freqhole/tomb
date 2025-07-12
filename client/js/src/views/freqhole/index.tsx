import { Router } from "@solidjs/router";
import { routes } from "./routes";
import { StoreProvider } from "./store";

export default function Freqhole() {
  return (
    <StoreProvider>
      <Router>{routes}</Router>
    </StoreProvider>
  );
}
