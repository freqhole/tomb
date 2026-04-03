import { Repo } from "@automerge/automerge-repo";

/**
 * create a lightweight in-memory Automerge repo for testing.
 * no storage adapter, no network adapter — pure in-memory.
 */
export function createTestRepo(): Repo {
  return new Repo({});
}

/**
 * wait for a condition to become true, polling at short intervals.
 * use this instead of setTimeout-based waits for sync convergence.
 *
 * throws if the condition is not met within the timeout.
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const { timeout = 5000, interval = 10 } = options;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out after ${timeout}ms`);
}
