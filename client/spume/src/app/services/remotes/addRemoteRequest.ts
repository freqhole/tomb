// cross-component "please open the add-remote modal with this value"
// request channel - lets any component (e.g. TopNavSearch, when a user
// pastes a `?r=` add-remote link into the search box) trigger App.tsx's
// AddRemoteModal without needing direct access to its local signals.
// mirrors the `#?share=` hash-token pattern already used for share links.
import { createSignal } from "solid-js";

const [request, setRequest] = createSignal<{ value: string; nonce: number } | null>(null);
let nonce = 0;

export const addRemoteRequest = request;

/** requests that App.tsx open AddRemoteModal pre-filled with `value`. uses
 *  a bumped nonce so repeated identical values still re-trigger. */
export function requestAddRemote(value: string): void {
  setRequest({ value, nonce: ++nonce });
}
