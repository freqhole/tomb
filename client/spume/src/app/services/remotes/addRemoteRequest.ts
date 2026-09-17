// cross-component "please open the add-remote modal with this value"
// request channel - lets any component (e.g. TopNavSearch, when a user
// pastes a `?r=` add-remote link into the search box) trigger App.tsx's
// AddRemoteModal without needing direct access to its local signals.
// mirrors the `#?share=` hash-token pattern already used for share links.
import { createSignal } from "solid-js";

export interface AddRemoteRequest {
  value: string;
  nonce: number;
  /** "player" when the caller already knows this is a player-pairing
   *  flow (a reconnect toast action, or the paired-players settings
   *  view) rather than a generic "might be a remote server" address -
   *  tells AddRemoteModal to skip its normal auth/knock ui entirely and
   *  show only the pin form, same as scanning the player's own qr code. */
  intent?: "player";
}

const [request, setRequest] = createSignal<AddRemoteRequest | null>(null);
let nonce = 0;

export const addRemoteRequest = request;

/** requests that App.tsx open AddRemoteModal pre-filled with `value`. uses
 *  a bumped nonce so repeated identical values still re-trigger. */
export function requestAddRemote(value: string, opts?: { intent?: "player" }): void {
  setRequest({ value, nonce: ++nonce, intent: opts?.intent });
}
