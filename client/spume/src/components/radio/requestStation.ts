// shared "submit one or more items to a station's request queue" logic.
//
// two distinct call shapes, NOT interchangeable:
// - `submitRequestAndOfferListen` - toast + optional "listen" link,
//   never auto-tunes. for `AddToStationModal.tsx`'s manual "add to
//   station" picker, a genuinely separate, explicit "send this to a
//   queue" action - fire-and-forget is the correct UX there.
// - `submitRequestAndTune` - tunes in immediately on success, no
//   success toast at all. for every "stream on X" entry reached from a
//   play-shaped control (play button flyouts, "play"-adjacent context
//   menu entries - see `useStreamFlyoutActions.ts`) - the whole point
//   of those is that they act like "play", not like "send to a queue,
//   maybe tune in later". see docs/backlog-video.md item #3's
//   "re-scoped design" section ("...then tunes in") for the original,
//   explicit spec this was built against - an earlier implementation
//   round wired the flyout to `submitRequestAndOfferListen` instead
//   (reusing the modal's code, without re-checking it against that
//   spec), which is the bug `submitRequestAndTune` exists to fix.
import { getClientForRemote } from "../../app/api/client";
import { tuneRadio } from "../../app/services/players/playerRadio";
import type { RemoteRef } from "../../app/services/storage/types";
import { toast, type ToastAction } from "../feedback/Toast";
import type { PublicStation } from "@freqhole/api-client";

export interface TuneTarget {
  peerAddr: string;
  isLocal: boolean;
}

// derives tuneIntoRadio's (peerAddr, isLocal) from anything shaped like a
// Remote/CurrentRemoteInfo - both share these same optional field names,
// so no type-guard narrowing is needed. mirrors RadioView.tsx's handleTune
// peer-resolution logic for a `self` source.
export function tuneTargetFor(remote: {
  is_charnel_managed?: boolean;
  peer_addr?: string;
  base_url?: string;
}): TuneTarget | null {
  if (remote.is_charnel_managed) return { peerAddr: "self", isLocal: true };
  if (remote.peer_addr) return { peerAddr: remote.peer_addr, isLocal: false };
  if (remote.base_url) return { peerAddr: remote.base_url, isLocal: false };
  return null;
}

// "listen" toast action for a just-requested station - undefined (no
// action button) when the tune target couldn't be resolved, rather than
// wiring a button that would silently no-op. only ever reached from a
// request-submission flow, so `acceptsRequests` is always true here -
// but still threaded explicitly through `tuneIntoRadio` rather than
// hardcoded, in case a non-request-station caller shows up later.
export function listenAction(
  target: TuneTarget | null,
  stationId: string,
  stationName: string,
  acceptsRequests: boolean
): ToastAction | undefined {
  if (!target) return undefined;
  return {
    label: "listen",
    onClick: () => {
      void tuneRadio(target.peerAddr, {
        stationId,
        stationName,
        isLocal: target.isLocal,
        acceptsRequests,
      });
    },
  };
}

export interface RequestQueueItem {
  kind: "song" | "video";
  itemId: string;
  /** resume where a previous listener left off - only ever meaningful on
   *  the first item of a multi-item request (an album/series' remaining
   *  items haven't been watched/listened to yet, so they start fresh). */
  startPositionSeconds?: number;
}

/** shared submit loop (items are awaited one at a time, not
 *  Promise.all, so a multi-item target like an album or series lands
 *  in the queue in the right order) - both public functions below call
 *  this rather than duplicating it. returns the number of items
 *  actually submitted; shows an error toast and returns 0 on total
 *  failure (the single-item case, or every item in a multi-item batch
 *  failing), so neither caller needs its own try/catch around this
 *  loop. */
async function submitRequestItems(
  station: PublicStation,
  items: RequestQueueItem[],
  remote: RemoteRef
): Promise<number> {
  try {
    const client = await getClientForRemote(remote);
    let submitted = 0;
    for (const item of items) {
      const result = await client.app.radioSubmitRequest({
        station_id: station.station_id,
        kind: item.kind,
        item_id: item.itemId,
        start_position_seconds: item.startPositionSeconds,
      });
      if (result.success) {
        submitted += 1;
      } else if (items.length === 1) {
        const msg = result.error.issues[0]?.message || "failed to submit request";
        toast.error(msg);
        return 0;
      }
      // for a multi-item (album/series) request, one failed item
      // shouldn't abort the rest - just tally it and keep going.
    }
    if (submitted === 0) {
      toast.error("failed to submit request");
    }
    return submitted;
  } catch (e) {
    toast.error(`failed to submit request: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}

/** submits one or more items to a station's request queue, then shows a
 *  success/failure toast with a "listen" action that tunes straight into
 *  the station. returns true if at least one item was submitted.
 *
 *  for `AddToStationModal.tsx`'s manual "add to station" picker ONLY -
 *  see this file's top comment for why `submitRequestAndTune` below is
 *  the correct call for anything play-shaped. */
export async function submitRequestAndOfferListen(
  station: PublicStation,
  items: RequestQueueItem[],
  remote: RemoteRef,
  label: string
): Promise<boolean> {
  const submitted = await submitRequestItems(station, items, remote);
  if (submitted === 0) return false;
  const itemWord = items[0]?.kind === "video" ? "episodes" : "songs";
  const resultLabel =
    items.length > 1 ? `${submitted}/${items.length} ${itemWord} from ${label}` : label;
  toast.success(`requested ${resultLabel} on "${station.name}"`, {
    action: listenAction(
      tuneTargetFor(remote),
      station.station_id,
      station.name,
      station.accepts_requests
    ),
  });
  return true;
}

/** submits one or more items to a station's request queue, then tunes
 *  straight into the station immediately - no success toast, no
 *  waiting for the user to click anything. for every "stream on X"
 *  entry reached from a play-shaped control (see this file's top
 *  comment) - clicking something that reads like "play" should,
 *  unambiguously, result in playback starting.
 *
 *  a failed submit shows an error toast (same wording/shape
 *  `submitRequestAndOfferListen` uses). a failed *tune* after a
 *  successful submit deliberately does NOT show its own toast -
 *  `tuneIntoRadio` already sets the reactive `radioError` signal the
 *  player UI surfaces on failure (see `radioService.ts`), and
 *  `RadioView.tsx`'s own manual tune button follows the same
 *  catch-and-log-only precedent for that exact reason. the one
 *  exception is a tune target that couldn't be resolved at all (no
 *  peer/base_url on `remote`) - that never reaches `tuneIntoRadio`, so
 *  there's no reactive error to fall back on, and gets an explicit
 *  toast instead. returns true only if both the submit and the tune
 *  succeeded. */
export async function submitRequestAndTune(
  station: PublicStation,
  items: RequestQueueItem[],
  remote: RemoteRef
): Promise<boolean> {
  const submitted = await submitRequestItems(station, items, remote);
  if (submitted === 0) return false;
  const target = tuneTargetFor(remote);
  if (!target) {
    toast.error("could not resolve a connection to this station");
    return false;
  }
  try {
    await tuneRadio(target.peerAddr, {
      stationId: station.station_id,
      stationName: station.name,
      isLocal: target.isLocal,
      acceptsRequests: station.accepts_requests,
    });
    return true;
  } catch (e) {
    console.error("[stream] requested successfully, but failed to tune in:", e);
    return false;
  }
}
