// refresh persisted fields without replacing edits the user has not saved.
export function mergeEditorData<T extends object>(current: T, initial: T | null, latest: T): T {
  if (!initial) return latest;
  const merged = { ...latest };
  for (const key of Object.keys(latest) as (keyof T)[]) {
    if (current[key] !== initial[key]) merged[key] = current[key];
  }
  return merged;
}
