// debounce a reactive boolean for UI loading indicators: turning true is
// delayed by `delayMs` (so a load that finishes quickly never flashes a
// loading indicator at all), turning false is immediate.
import { createSignal, createEffect, onCleanup } from "solid-js";

export function createDebouncedBoolean(source: () => boolean, delayMs = 1000): () => boolean {
  const [debounced, setDebounced] = createSignal(source());
  let timer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    const value = source();
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (value) {
      timer = setTimeout(() => {
        timer = undefined;
        setDebounced(true);
      }, delayMs);
    } else {
      setDebounced(false);
    }
  });

  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  return debounced;
}
