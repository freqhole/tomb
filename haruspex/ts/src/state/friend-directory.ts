// friend-directory - a best-effort friend list for "pick one of your
// friends" pickers, kept framework-free: this subpath never touches
// automerge/pixi/solid directly. resolving the actual friend records
// (wherever they live - an automerge doc, a sqlite table, an api call) is
// always the caller's job; this module only owns the pure candidate
// shape/selection logic and a best-effort async wrapper around it.

/** one raw friend entry, as read from wherever an app stores its friend list. */
export interface FriendDirectoryEntry {
  /** a display name override the local user set for this friend, if any. */
  alias?: string;
  /** the friend's own reported username, if known. */
  username?: string;
  /** every node id this friend is known to use, each with its own optional
   *  profile doc pointer and reported username. */
  nodeIds: Array<{ nodeId: string; profileDocId?: string; username?: string }>;
}

/** one friend candidate for a "pick a friend" picker ui. */
export interface FriendPickerCandidate {
  nodeId: string;
  profileDocId: string;
  displayName: string;
}

/**
 * pure filter/map step: turn raw friend entries into picker candidates.
 * a friend is only offered as a candidate once it has at least one node id
 * with a known profile doc pointer - there'd be nothing for the picker to
 * open otherwise. display name preference: alias, then the friend's own
 * username, then the chosen node id's reported username, then "friend".
 */
export function buildFriendDirectory(entries: FriendDirectoryEntry[]): FriendPickerCandidate[] {
  const candidates: FriendPickerCandidate[] = [];
  for (const entry of entries) {
    const nodeEntry = entry.nodeIds.find((n) => n.profileDocId);
    if (!nodeEntry || !nodeEntry.profileDocId) continue;
    const displayName = entry.alias || entry.username || nodeEntry.username || "friend";
    candidates.push({
      nodeId: nodeEntry.nodeId,
      profileDocId: nodeEntry.profileDocId,
      displayName,
    });
  }
  return candidates;
}

/**
 * best-effort candidate list for a "pick a friend" picker: calls the
 * injected loader for the raw friend entries and runs them through
 * buildFriendDirectory(). returns `[]` on any failure (no friend list yet,
 * the loader's own backend unreachable) rather than throwing - matches
 * this kind of picker's usual "best effort, no error ui" convention.
 */
export async function getFriendsForPicker(
  loadEntries: () => Promise<FriendDirectoryEntry[]>,
): Promise<FriendPickerCandidate[]> {
  try {
    const entries = await loadEntries();
    return buildFriendDirectory(entries);
  } catch {
    return [];
  }
}
