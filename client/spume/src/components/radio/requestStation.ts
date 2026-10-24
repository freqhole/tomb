// shared "submit one or more items to a station's request queue, then
// offer a 'listen' toast action" logic - used by both
// AddToStationModal.tsx's manual request picker AND the video play
// button's auto-pick-a-station flow (see pickStreamStation.ts), so the
// two stay in sync instead of duplicating the submit-loop/toast logic.
import { getClientForRemote } from "../../app/api/client";
import { tuneIntoRadio } from "../../app/services/radio/radioService";
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
// wiring a button that would silently no-op.
export function listenAction(
  target: TuneTarget | null,
  stationId: string,
  stationName: string
): ToastAction | undefined {
  if (!target) return undefined;
  return {
    label: "listen",
    onClick: () => {
      void tuneIntoRadio(target.peerAddr, {
        stationId,
        stationName,
        isLocal: target.isLocal,
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

/** submits one or more items to a station's request queue (FIFO - items
 *  are awaited one at a time, not Promise.all, so a multi-item target
 *  like an album or series lands in the right order), then shows a
 *  success/failure toast with a "listen" action that tunes straight into
 *  the station. returns true if at least one item was submitted. */
export async function submitRequestAndOfferListen(
  station: PublicStation,
  items: RequestQueueItem[],
  remote: RemoteRef,
  label: string
): Promise<boolean> {
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
        return false;
      }
      // for a multi-item (album/series) request, one failed item
      // shouldn't abort the rest - just tally it and keep going.
    }
    if (submitted === 0) {
      toast.error("failed to submit request");
      return false;
    }
    const itemWord = items[0]?.kind === "video" ? "episodes" : "songs";
    const resultLabel =
      items.length > 1 ? `${submitted}/${items.length} ${itemWord} from ${label}` : label;
    toast.success(`requested ${resultLabel} on "${station.name}"`, {
      action: listenAction(tuneTargetFor(remote), station.station_id, station.name),
    });
    return true;
  } catch (e) {
    toast.error(`failed to submit request: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
