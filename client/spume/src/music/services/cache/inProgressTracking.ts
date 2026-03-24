// in-progress fetch tracking - separate file to avoid circular deps
// used by both blobCache.ts and db.ts

// track in-progress fetches to avoid duplicate requests
const inProgressFetches = new Set<string>();

export function hasInProgressFetch(key: string): boolean {
  return inProgressFetches.has(key);
}

export function addInProgressFetch(key: string): void {
  inProgressFetches.add(key);
}

export function deleteInProgressFetch(key: string): void {
  inProgressFetches.delete(key);
}

export function clearInProgressTracking(): void {
  inProgressFetches.clear();
}
