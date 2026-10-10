// regression test for `toQueueHistorySourceType` - the server's
// `session_type` field is an open-ended `string` on the wire (new session
// types can ship server-side independently of any given client build), but
// `QueueSourceContext.type` is a closed `QueueHistorySourceType` union.
// FeedView.tsx used to bridge that gap with `as any`, silently trusting
// whatever the server sent - a session type the client doesn't recognize
// would have flowed straight into queue-history storage/rendering code
// that switches exhaustively over the union, rather than failing safely.

import { describe, expect, it } from "vitest";
import { toQueueHistorySourceType } from "./types";

describe("toQueueHistorySourceType", () => {
  it("passes through every known source type unchanged", () => {
    const known = ["song", "album", "artist", "genre", "playlist", "shuffle", "radio_station"];
    for (const type of known) {
      expect(toQueueHistorySourceType(type)).toBe(type);
    }
  });

  it("falls back to shuffle for a session type this build doesn't recognize", () => {
    expect(toQueueHistorySourceType("some_future_session_type")).toBe("shuffle");
  });

  it("falls back to shuffle for an empty string", () => {
    expect(toQueueHistorySourceType("")).toBe("shuffle");
  });
});
