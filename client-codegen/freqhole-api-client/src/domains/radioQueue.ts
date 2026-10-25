// radio queue domain methods for FreqholeClient.
//
// thin wrappers over the transport's `subscribeRadioQueueEvents`
// capability. transports that don't implement it fall back to the
// polling-diff iterator (see transport.ts) - same precedent as
// `domains/jobs.ts`. no dedicated snapshot method here: the existing
// `client.app.radioListRequests` route already works transparently
// against local-or-remote stations through any transport, so there's
// nothing extra to wrap.

import type { Transport } from "../transport.js";
import { pollingRadioQueueEvents } from "../transport.js";
import type { RadioQueueEvent, RadioQueueEventFilter } from "../codegen/schema.js";

export function createRadioQueueMethods(transport: Transport) {
  return {
    events: {
      /**
       * live subscription to one station's request-queue events.
       * iterates `RadioQueueEvent`s (`Submitted`/`Removed`/`Reordered`/
       * `Cleared`) until the stream ends or the optional `signal` is
       * aborted. transports without native streaming use the
       * polling-diff fallback.
       */
      subscribe: (
        filter: RadioQueueEventFilter,
        signal?: AbortSignal,
      ): AsyncIterable<RadioQueueEvent> => {
        if (transport.subscribeRadioQueueEvents) {
          return transport.subscribeRadioQueueEvents(filter, signal);
        }
        return pollingRadioQueueEvents(transport, filter, signal);
      },
    },
  };
}
