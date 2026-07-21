// endpoint-control - a module-level singleton bridging a p2p transport
// adapter to any ui code that needs to read or toggle its lifecycle state
// without holding a direct reference to the adapter itself. an app calls
// registerEndpointAdapter() once at startup; anything else (a settings
// panel, a status pill) imports the helpers below to read/toggle.
//
// the adapter is a structural type, not an import of any concrete
// transport - this subpath never depends on midden or any particular p2p
// implementation, only on something shaped like `EndpointAdapter`.

/** the p2p endpoint's lifecycle state, for ui display. */
export type EndpointState = "off" | "starting" | "online" | "error";

/** the structural surface this subpath needs from a p2p transport adapter. */
export interface EndpointAdapter {
  stop(): void;
  restart(): Promise<void>;
  getEndpointState(): EndpointState;
  onEndpointStateChange(handler: (state: EndpointState) => void): () => void;
}

let adapter: EndpointAdapter | null = null;

/** register the adapter - call once, after the adapter is created. */
export function registerEndpointAdapter(next: EndpointAdapter): void {
  adapter = next;
}

/** forget the registered adapter (teardown, test isolation). */
export function clearEndpointAdapter(): void {
  adapter = null;
}

/** stop the p2p endpoint; can be resumed with restartEndpoint(). */
export function stopEndpoint(): void {
  adapter?.stop();
}

/** restart the p2p endpoint after it was stopped. */
export function restartEndpoint(): Promise<void> {
  return adapter?.restart() ?? Promise.resolve();
}

/** the current endpoint state, synchronously. "off" when no adapter is registered. */
export function getEndpointState(): EndpointState {
  return adapter?.getEndpointState() ?? "off";
}

/** subscribe to endpoint state changes. returns an unsubscribe function. */
export function onEndpointStateChange(handler: (state: EndpointState) => void): () => void {
  return adapter?.onEndpointStateChange(handler) ?? (() => {});
}
