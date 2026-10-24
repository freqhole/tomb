// resolves "what station am I actually tuned into right now, and does
// it accept member requests" - the gate for showing a live request-queue
// section in the sidebar (see QueueSidebar.tsx). globally available
// (reads the same app-wide `currentRadioStation`/`radioStatus` signals
// AppLayout.tsx itself already reads), so this works regardless of
// whether RadioView is even mounted - the sidebar is visible from every
// page, not just the radio view.
import { createQuery } from "@tanstack/solid-query";
import { createMemo } from "solid-js";
import type { PublicStation } from "@freqhole/api-client";
import { getClientForRemote } from "../../app/api/client";
import { getAllRemotes } from "../../app/services/remotes/remoteManager";
import { currentRadioStation } from "../../app/services/storage/currentRadioStation";
import { radioStatus } from "../../app/services/radio/radioService";
import { isHttpRemote, isP2PRemote, type Remote } from "../../app/services/storage/types";

/** mirrors AppLayout.tsx's own `resolveShareSourceRemote` matching logic
 *  (kept as a free function here, not a shared export, since that one is
 *  itself scoped to AppLayout's local `remotes()` signal - this hook
 *  needs to be callable with no local state of its own). */
function matchRemote(all: Remote[], peerAddr: string, isLocal: boolean | undefined): Remote | null {
  if (isLocal) {
    return all.find((r) => r.is_charnel_managed) ?? null;
  }
  return (
    all.find((r) => {
      if (isP2PRemote(r)) return r.peer_addr === peerAddr;
      if (isHttpRemote(r)) return r.base_url === peerAddr;
      return false;
    }) ?? null
  );
}

/** true once tuned-in has reached (or is reaching) an actually-playing
 *  state - `"idle"`/`"error"` mean there's no live station context worth
 *  showing a request queue for. */
function isTunedIn(status: ReturnType<typeof radioStatus>): boolean {
  return status === "playing" || status === "connecting" || status === "paused";
}

export function useCurrentTunedStation() {
  const station = currentRadioStation;

  const remoteQuery = createQuery(() => ({
    queryKey: ["radio", "currentStationRemote", station()?.peer_addr ?? "none"],
    queryFn: async () => {
      const s = station();
      if (!s) return null;
      const all = await getAllRemotes();
      return matchRemote(all, s.peer_addr, s.is_local);
    },
    enabled: isTunedIn(radioStatus()) && !!station(),
    staleTime: 60 * 1000,
  }));

  const remote = createMemo(() => remoteQuery.data ?? null);

  const stationsQuery = createQuery(() => ({
    queryKey: ["radio", "stationsFullForCurrent", remote()?.remote_id ?? "none"],
    queryFn: async () => {
      const r = remote();
      if (!r) return [];
      const client = await getClientForRemote(r);
      const result = await client.app.radioStationsFull();
      return result.success ? result.data.stations : [];
    },
    enabled: isTunedIn(radioStatus()) && !!remote(),
    staleTime: 30 * 1000,
  }));

  const stationInfo = createMemo((): PublicStation | null => {
    if (!isTunedIn(radioStatus())) return null;
    const id = station()?.station_id;
    if (!id) return null;
    return (stationsQuery.data ?? []).find((s) => s.station_id === id) ?? null;
  });

  return { remote, stationInfo };
}
