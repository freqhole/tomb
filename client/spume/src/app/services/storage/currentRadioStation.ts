// current radio station persistence service
// tracks the currently tuned station in IndexedDB so it can be resumed on page reload

import { createSignal } from "solid-js";
import { initAppDB, updateAppState } from "./db";
import { STORE_APP_STATE } from "./types";
import type { RadioStationRef } from "./types";

// reactive signal for the current radio station (null when not tuned)
const [currentRadioStation, setCurrentRadioStation] = createSignal<RadioStationRef | null>(null);
export { currentRadioStation };

// load current radio station from IndexedDB
export async function loadCurrentRadioStation(): Promise<RadioStationRef | null> {
  try {
    const db = await initAppDB();
    const state = await db.get(STORE_APP_STATE, "app_state");
    const station = state?.current_radio_station ?? null;
    setCurrentRadioStation(station);
    return station;
  } catch (error) {
    console.error("failed to load current radio station:", error);
    return null;
  }
}

// save the current radio station to IndexedDB (and update signal).
// routes through updateAppStatePublic so we don't race against other
// concurrent appState writers (e.g. setQueue) by reading + writing
// STORE_APP_STATE directly with a stale snapshot.
export async function setCurrentRadioStationPersisted(
  station: RadioStationRef | null,
): Promise<void> {
  try {
    await updateAppState({ current_radio_station: station });
    setCurrentRadioStation(station);
  } catch (error) {
    console.error("failed to save current radio station:", error);
  }
}

// clear the current radio station
export async function clearCurrentRadioStation(): Promise<void> {
  return setCurrentRadioStationPersisted(null);
}
