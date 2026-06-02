import {
  ENRICHMENT_SOURCES,
  EMPTY_SESSION,
  SESSION_SETTLE_LINGER_MS,
  type EnrichmentSource,
} from "./types";
import { inflight, session, setSession } from "./state";

// linger timer that resets the session strip after the burst settles
let lingerTimer: ReturnType<typeof setTimeout> | null = null;

/** read-only accessor for the burst-level progress session. */
export function useMbSession() {
  return session;
}

/** dismiss the session strip (e.g. user clicked the close button). */
export function dismissMbSession(): void {
  if (lingerTimer) {
    clearTimeout(lingerTimer);
    lingerTimer = null;
  }
  setSession(EMPTY_SESSION());
}

/**
 * record a new burst that touches three sources × albumIds.length jobs.
 * the strip will show "0 / N" immediately and fill in as jobs settle.
 */
export function startOrExtendSession(remoteId: string, addedAlbumCount: number) {
  if (lingerTimer) {
    clearTimeout(lingerTimer);
    lingerTimer = null;
  }
  const addedTotal = addedAlbumCount * 3;
  setSession((s) => {
    // if a previous burst settled but is still in linger window, start fresh.
    const settled = s.lastSettledAt !== null && !s.isActive;
    const fresh = settled || s.remoteId !== remoteId;
    const base = fresh ? EMPTY_SESSION() : s;
    const bySource = { ...base.bySource };
    for (const src of ENRICHMENT_SOURCES) {
      bySource[src] = {
        ...bySource[src],
        enqueued: bySource[src].enqueued + addedAlbumCount,
      };
    }
    return {
      ...base,
      bySource,
      enqueued: base.enqueued + addedTotal,
      isActive: true,
      remoteId,
    };
  });
}

export function failSourceSession(source: EnrichmentSource, message: string, count: number) {
  setSession((s) => {
    const bySource = { ...s.bySource };
    bySource[source] = {
      ...bySource[source],
      failed: bySource[source].failed + count,
    };
    const stillActive = countActive() > 0;
    return {
      ...s,
      bySource,
      failed: s.failed + count,
      lastError: message,
      isActive: stillActive,
      lastSettledAt: stillActive ? null : Date.now(),
    };
  });
  scheduleSessionLinger();
}

export function failSession(message: string, count: number) {
  // attribute to all three sources equally (transport-level failure)
  for (const src of ENRICHMENT_SOURCES) {
    failSourceSession(src, message, count);
  }
}

function countActive(): number {
  return inflight().size;
}

export function scheduleSessionLinger() {
  if (lingerTimer) clearTimeout(lingerTimer);
  if (countActive() > 0) return;
  lingerTimer = setTimeout(() => {
    setSession(EMPTY_SESSION());
    lingerTimer = null;
  }, SESSION_SETTLE_LINGER_MS);
}
