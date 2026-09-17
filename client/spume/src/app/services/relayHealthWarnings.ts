// surfaces a couple of iroh/midden relay-connectivity warnings as a
// single, deduped toast - today these only ever show up as raw
// console.warn lines from the wasm module's own tracing output (see
// logCapture.ts), completely invisible to a user who isn't watching
// devtools or the in-app logz view. a real capture showed a relay
// rate-limiting warning (and two "lost connection to relay server: ping
// timeout" warnings) fire right as a queue push stalled for ~60s - worth
// telling the user something's going on, gently, without spamming a new
// toast every time the underlying wasm module logs the same warning
// again a moment later.
//
// subscribes to logCapture's ring buffer (rather than re-patching
// console itself, which logCapture.ts already does) so this stays a
// pure "watch already-captured output" concern - no new console patching
// here.

import { subscribe, snapshot, type LogEntry } from "./logCapture";
import { toast } from "../../components/feedback/Toast";

let installed = false;
let lastSeenId = 0;

const RATE_LIMIT_PATTERN = "rate-limiting this endpoint";
const RELAY_LOST_PATTERN = "Lost connection to relay server";

function handleEntries(entries: ReadonlyArray<LogEntry>): void {
  for (const entry of entries) {
    if (entry.id <= lastSeenId) continue;
    lastSeenId = entry.id;
    if (entry.level !== "warn" && entry.level !== "error") continue;
    if (entry.message.includes(RATE_LIMIT_PATTERN)) {
      // toast.warning's own dedupe key (variant + title) already collapses
      // repeat warnings into one toast instead of spraying a new one per
      // occurrence - see Toast.tsx.
      toast.warning(
        "the network relay is temporarily limiting traffic to a remote - things may load slowly for a bit",
        { title: "relay-rate-limited" }
      );
    } else if (entry.message.includes(RELAY_LOST_PATTERN)) {
      toast.warning("lost connection to a network relay - reconnecting...", {
        title: "relay-connection-lost",
      });
    }
  }
}

/** call once at app boot (see App.tsx's other `install*` boot steps) - a
 * no-op on every call after the first. */
export function installRelayRateLimitWatcher(): void {
  if (installed) return;
  installed = true;
  // only react to warnings from this point forward - logCapture's
  // subscribe() replays the whole existing buffer immediately, which
  // would otherwise toast about a rate-limit that already happened
  // before this module even loaded.
  const existing = snapshot();
  lastSeenId = existing.length > 0 ? existing[existing.length - 1].id : 0;
  subscribe(handleEntries);
}
