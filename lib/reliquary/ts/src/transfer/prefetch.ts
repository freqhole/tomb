// budget-limited, cancellable prefetch: select a prefix of "upcoming"
// items whose cumulative cost fits a budget (e.g. seconds of playback,
// bytes of storage), then fetch them in concurrent batches.
//
// the domain concept (what an item is, what it costs, how to fetch it)
// stays with the caller via `costOf`/`fetchItem`; this module only owns
// the budget selection, concurrency batching, and run-counter
// cancellation.

/** what one prefetch run needs to know how to do. */
export interface PrefetchOptions<T> {
  /** total budget consumed as items are selected for this run; selection
   *  stops once the budget is exhausted (or the item list runs out). */
  budget: number;
  /** cost of fetching one item, subtracted from the budget as items are
   *  selected. */
  costOf(item: T): number;
  /** fetch one selected item. */
  fetchItem(item: T): Promise<void>;
  /** how many items to fetch concurrently. default 3. */
  concurrency?: number;
  /** called once per item, when it is selected for this run (before any
   *  fetching starts) - useful for a "pending" ui state. */
  onPending?(item: T): void;
  /** called once per item whose `onPending` fired, when its fetch settles
   *  (success, failure, or superseded by a newer `run()` before it was
   *  reached) - always paired with a prior `onPending` call. */
  onSettled?(item: T): void;
}

/**
 * a cancellable prefetch runner. calling `run()` again before a prior run
 * finishes supersedes it: a run-counter check before every selection and
 * batch step stops the superseded run from selecting or fetching anything
 * further, without needing an `AbortController` threaded through
 * `fetchItem` itself.
 */
export class Prefetcher<T> {
  private runCounter = 0;

  /** fire-and-forget: start a new run over `items`, superseding any run
   *  still in flight. */
  run(items: T[], options: PrefetchOptions<T>): void {
    const run = ++this.runCounter;
    void this.execute(run, items, options);
  }

  private isCurrent(run: number): boolean {
    return run === this.runCounter;
  }

  private async execute(run: number, items: T[], options: PrefetchOptions<T>): Promise<void> {
    const concurrency = options.concurrency ?? 3;
    let budget = options.budget;
    const selected: T[] = [];

    for (const item of items) {
      if (!this.isCurrent(run)) return;
      if (budget <= 0) break;
      budget -= options.costOf(item);
      options.onPending?.(item);
      selected.push(item);
    }

    for (let i = 0; i < selected.length; i += concurrency) {
      if (!this.isCurrent(run)) {
        for (const item of selected.slice(i)) options.onSettled?.(item);
        return;
      }
      const batch = selected.slice(i, i + concurrency);
      await Promise.allSettled(
        batch.map(async (item) => {
          try {
            await options.fetchItem(item);
          } finally {
            options.onSettled?.(item);
          }
        })
      );
    }
  }
}

/** construct a fresh, independent prefetch runner. */
export function createPrefetcher<T>(): Prefetcher<T> {
  return new Prefetcher<T>();
}
