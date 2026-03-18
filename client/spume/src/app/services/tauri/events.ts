/**
 * tauri event listeners (Rust → JS via emit/listen)
 *
 * these functions wrap tauri's listen() with proper typing via zod schemas.
 * they are only callable in tauri mode.
 */

import {
  TauriEventSchema,
  type TauriEvent,
  type ConfigChangedEvent,
  type ScanProgressEvent,
  type ScanCompleteEvent,
  type KnockCreatedEvent,
} from "./schema";

// event name used for all freqhole events (single channel, discriminated by type)
const EVENT_NAME = "freqhole:event";

type UnlistenFn = () => void;

// dynamically import tauri to allow tree-shaking in browser builds
async function getListen() {
  const { listen } = await import("@tauri-apps/api/event");
  return listen;
}

/**
 * listen for all freqhole events from tauri backend
 *
 * events are discriminated by `type` field. use this for a unified handler,
 * or use the specific listeners below for individual event types.
 *
 * @returns unlisten function to stop listening
 */
export async function onEvent(callback: (event: TauriEvent) => void): Promise<UnlistenFn> {
  const listen = await getListen();
  
  const unlisten = await listen<unknown>(EVENT_NAME, (event) => {
    try {
      const parsed = TauriEventSchema.parse(event.payload);
      callback(parsed);
    } catch (error) {
      console.error("[tauri/events] failed to parse event:", error, event.payload);
    }
  });
  
  return unlisten;
}

/**
 * listen specifically for config-changed events
 *
 * fired when server config changes (via wizard). spume should refetch config.
 */
export async function onConfigChanged(
  callback: (event: ConfigChangedEvent) => void
): Promise<UnlistenFn> {
  return onEvent((event) => {
    if (event.type === "config-changed") {
      callback(event);
    }
  });
}

/**
 * listen specifically for scan-progress events
 *
 * fired during library scans with progress info.
 */
export async function onScanProgress(
  callback: (event: ScanProgressEvent) => void
): Promise<UnlistenFn> {
  return onEvent((event) => {
    if (event.type === "scan-progress") {
      callback(event);
    }
  });
}

/**
 * listen specifically for scan-complete events
 *
 * fired when library scan finishes.
 */
export async function onScanComplete(
  callback: (event: ScanCompleteEvent) => void
): Promise<UnlistenFn> {
  return onEvent((event) => {
    if (event.type === "scan-complete") {
      callback(event);
    }
  });
}

/**
 * listen specifically for knock-created events
 *
 * fired when a federation knock request is received.
 */
export async function onKnockCreated(
  callback: (event: KnockCreatedEvent) => void
): Promise<UnlistenFn> {
  return onEvent((event) => {
    if (event.type === "knock-created") {
      callback(event);
    }
  });
}
