// a scriptable stand-in for a blob transport: per-id behaviour (instant
// success, a delayed success, an unresolved stall, or a hard error) so a
// test can exercise progress/cancel/retry paths without real network
// flakiness or timing.

export type MockBlobBehaviour =
  | { type: "instant" }
  | { type: "delayed"; ms?: number }
  | { type: "stall" }
  | { type: "error"; message?: string };

const DEFAULT_DELAY_MS = 50;

export interface MockBlobFetcher {
  /** sets (or clears, with `null`) the simulated behaviour for `id`.
   *  an id with no behaviour set defaults to `{ type: "instant" }`. */
  setBehaviour(id: string, behaviour: MockBlobBehaviour | null): void;
  /** simulates fetching `id`: resolves/rejects/stalls according to its
   *  configured behaviour, then resolves with `resolveBytes(id)`'s
   *  result. `onProgress` (if given) is called once with `1` right
   *  before the bytes resolve - this double has no partial-progress
   *  simulation, only success/failure/stall timing. */
  fetchBlob(id: string, onProgress?: (fraction: number) => void): Promise<Uint8Array>;
}

/**
 * creates a mock blob fetcher: a per-id behaviour table plus a
 * `fetchBlob` function that simulates it, generalized off the pattern of
 * installing a fetch override that a mocked transport consults instead of
 * making a real network call. the actual bytes returned on success come
 * from the caller-supplied `resolveBytes` (typically `deterministicBytes`
 * or `makeWav`) - this helper only controls timing and success/failure,
 * not payload shape.
 */
export function createMockBlobFetcher(resolveBytes: (id: string) => Uint8Array | Promise<Uint8Array>): MockBlobFetcher {
  const behaviours = new Map<string, MockBlobBehaviour>();

  function setBehaviour(id: string, behaviour: MockBlobBehaviour | null): void {
    if (behaviour) behaviours.set(id, behaviour);
    else behaviours.delete(id);
  }

  async function fetchBlob(id: string, onProgress?: (fraction: number) => void): Promise<Uint8Array> {
    const behaviour = behaviours.get(id) ?? { type: "instant" };

    if (behaviour.type === "error") {
      throw new Error(behaviour.message ?? `mock blob error: ${id}`);
    }

    if (behaviour.type === "stall") {
      // never resolves - simulates a hung transport for cancel-path tests
      return new Promise<Uint8Array>(() => {});
    }

    if (behaviour.type === "delayed") {
      await new Promise<void>((resolve) => setTimeout(resolve, behaviour.ms ?? DEFAULT_DELAY_MS));
    }

    onProgress?.(1);
    return await resolveBytes(id);
  }

  return { setBehaviour, fetchBlob };
}
