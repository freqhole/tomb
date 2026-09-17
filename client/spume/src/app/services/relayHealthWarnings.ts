// surfaces iroh/midden relay rate-limiting as an occasional, deduped toast
// - this only ever shows up as a raw console.warn line from the wasm
// module's own tracing output (see logCapture.ts), completely invisible to
// a user who isn't watching devtools or the in-app logz view.
//
// the "lost connection to relay server" warning that used to also toast
// here was torn out entirely - relays reconnect on their own constantly as
// a normal, healthy part of iroh's connectivity, and it fired far too
// often (and looked scarier than it was) to be worth a user-facing toast
// at all; see this file's own history if you're tempted to re-add it.
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

// toast.warning's own title-keyed dedupe (see Toast.tsx) only collapses
// repeats while a previous instance of THIS toast is still on screen - a
// flaky relay can easily trip the same warning again minutes later, well
// after the last toast auto-dismissed, which would otherwise show a fresh
// one every time. this cooldown makes the toast genuinely rare instead of
// merely "not simultaneously duplicated".
const RATE_LIMIT_TOAST_COOLDOWN_MS = 5 * 60_000;
let lastRateLimitToastAt = 0;

function handleEntries(entries: ReadonlyArray<LogEntry>): void {
  for (const entry of entries) {
    if (entry.id <= lastSeenId) continue;
    lastSeenId = entry.id;
    if (entry.level !== "warn" && entry.level !== "error") continue;
    if (!entry.message.includes(RATE_LIMIT_PATTERN)) continue;
    const now = Date.now();
    if (now - lastRateLimitToastAt < RATE_LIMIT_TOAST_COOLDOWN_MS) continue;
    lastRateLimitToastAt = now;
    toast.warning(
      "the network relay is temporarily limiting traffic to a remote - things may load slowly for a bit",
      { title: "relay-rate-limited" }
    );
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
