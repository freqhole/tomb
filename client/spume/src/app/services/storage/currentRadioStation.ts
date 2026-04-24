// current radio station persistence service
// tracks the currently tuned station in IndexedDB so it can be resumed on page reload

import { createSignal } from "solid-js";
import { initAppDB } from "./db";
import { STORE_APP_STATE } from "./types";
import type { AppState, RadioStationRef } from "./types";

// reactive signal for the current radio station (null when not tuned)
const [currentRadioStation, setCurrentRadioStation] = createSignal<RadioStationRef | null>(null);
export { currentRadioStation };

// load current radio station from IndexedDB
export async function loadCurrentRadioStation(): Promise<RadioStationRef | null> {
  try {
    const db = await initAppDB();
    const appState = await db.get(STORE_APP_STATE, "app_state");
    const station = appState?.current_radio_station ?? null;
    setCurrentRadioStation(station);
    return station;
  } catch (error) {
    console.error("failed to load current radio station:", error);
    return null;
  }
}

// save the current radio station to IndexedDB (and update signal)
export async function setCurrentRadioStationPersisted(
  station: RadioStationRef | null,
): Promise<void> {
  try {
    const db = await initAppDB();
    const appState: AppState = (await db.get(STORE_APP_STATE, "app_state")) || {
      id: "app_state",
      current_sha256: null,
      queue: [],
      queue_open: false,
      active_remote_id: null,
      last_updated: Date.now(),
    };

    appState.current_radio_station = station;
    appState.last_updated = Date.now();

    await db.put(STORE_APP_STATE, appState);
    setCurrentRadioStation(station);
  } catch (error) {
    console.error("failed to save current radio station:", error);
  }
}

// clear the current radio station
export async function clearCurrentRadioStation(): Promise<void> {
  return setCurrentRadioStationPersisted(null);
}
