// reactive accessor for the full `Remote` record corresponding to the
// current remote signal.
//
// `getCurrentRemote()` returns a lightweight `CurrentRemoteInfo` (display
// info + transport hints), but a lot of code wants the full `Remote` row
// from the local remotes table — eligibility checks, peer-addr extraction,
// auth-status lookups, and so on.
//
// this helper bridges the gap by reactively fetching the full `Remote`
// whenever the current remote id changes.

import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import { getCurrentRemote } from "../../../music/data/currentState";
import { getRemoteById } from "./remoteManager";
import type { Remote } from "../storage/schemas/remote";

/**
 * returns an accessor that resolves to the full `Remote` record for the
 * currently-selected source, or `null` for local / not-yet-loaded.
 *
 * the underlying signal is reactive — switching remotes triggers a refetch.
 */
export function createCurrentRemoteFull(): Accessor<Remote | null> {
  const [full, setFull] = createSignal<Remote | null>(null);

  createEffect(() => {
    // re-run whenever currentRemote signal updates. we read it via the
    // function so solid tracks it.
    const info = getCurrentRemote();
    if (!info) {
      setFull(null);
      return;
    }
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    void getRemoteById(info.remote_id).then((r) => {
      if (!cancelled) setFull(r ?? null);
    });
  });

  return full;
}
