// jobs domain methods for FreqholeClient.
//
// thin wrappers over the transport's `snapshotJobEvents` /
// `subscribeJobEvents` capability. transports that don't implement
// these fall back to the http polling iterator (see transport.ts).

import type { Transport } from "../transport.js";
import {
  pollingJobEvents,
  snapshotJobEventsViaRequest,
} from "../transport.js";
import type {
  EventFilter,
  JobEvent,
  JobStateSnapshot,
} from "../codegen/schema.js";

export function createJobsMethods(transport: Transport) {
  return {
    events: {
      /**
       * one-shot snapshot of currently-active jobs the caller can see.
       * use this to rehydrate state on mount / after a page reload.
       */
      snapshot: async (filter?: EventFilter): Promise<JobStateSnapshot[]> => {
        if (transport.snapshotJobEvents) {
          return transport.snapshotJobEvents(filter);
        }
        return snapshotJobEventsViaRequest(transport, filter);
      },

      /**
       * live subscription to job events. iterates `JobEvent`s until the
       * stream ends or the optional `signal` is aborted. transports
       * without native streaming use the http polling fallback.
       */
      subscribe: (
        filter?: EventFilter,
        signal?: AbortSignal,
      ): AsyncIterable<JobEvent> => {
        if (transport.subscribeJobEvents) {
          return transport.subscribeJobEvents(filter, signal);
        }
        return pollingJobEvents(transport, filter, signal);
      },
    },
  };
}
