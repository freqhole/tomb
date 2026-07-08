// cancellation detection shared by every ./transfer flow.
//
// a deliberate pause/cancel of an in-flight download must never be
// mistaken for a genuine failure: the per-peer retry loop in `snatch.ts`
// rethrows a cancelled error immediately instead of trying the next peer,
// and the disk-streaming path leaves the writable exactly as it is
// (no truncate) since a resumed download rewrites the same byte offsets.

/** exact error message a transport uses for a deliberately cancelled or
 *  paused download (as opposed to a transport failure). */
export const DOWNLOAD_CANCELLED_MESSAGE = "download cancelled";

/** true when `err` represents a deliberate pause/cancel (an AbortError, or
 *  the exact cancelled-download message above), as opposed to a genuine
 *  transfer failure. */
export function isCancelledError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  const message = err instanceof Error ? err.message : String(err);
  return message.includes(DOWNLOAD_CANCELLED_MESSAGE);
}
