// pure "is this queue row the real up-next item" decision, split out of
// CenotaphPlayerApp.tsx so it's testable without mounting that whole
// (heavy, tauri/charnel-importing) component tree.
//
// a real bug found live: the first queue row's art thumbnail showed a
// permanently-spinning "up next" loading overlay (MediaThumbnail.tsx's
// `isUpNext` prop) that never cleared - CenotaphPlayerApp.tsx hardcoded
// `isUpNext: i() === 0` (row index 0), which is unconditionally true for
// whatever happens to be first in the queue, regardless of whether
// anything is actually loading. The main app's own QueueSidebar.tsx/
// AppLayout.tsx get this right already: `isUpNext` should mirror
// `pendingUpNextSha256()` (see playerState.ts's doc comment - "a
// DIFFERENT song is downloading, shows spinner") - true only for the one
// specific item currently being prepared to auto-advance into, false the
// rest of the time (including whenever nothing is preloading at all).
export function isUpNextRow(itemKey: string, pendingUpNextKey: string | null): boolean {
  return pendingUpNextKey !== null && pendingUpNextKey === itemKey;
}
