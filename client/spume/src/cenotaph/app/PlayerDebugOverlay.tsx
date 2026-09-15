// devel-mode debug overlay for spume's /player/ route: a big, transparent,
// scrollable panel rendering every captured console.* line (see cenotaph's
// debug/consoleCapture.ts doc comment for why - no devtools access on tvs/
// embedded browsers). only rendered by CenotaphPlayerApp while develMode()
// is on. mirrors player.freqhole.net's now-abandoned `debug/DebugOverlay.tsx`.

import { createEffect, For } from "solid-js";
import { capturedLogLines, type CapturedLogLine } from "@freqhole/cenotaph";

const LEVEL_COLOR: Record<CapturedLogLine["level"], string> = {
  log: "text-neutral-300",
  info: "text-blue-300",
  warn: "text-yellow-300",
  error: "text-red-400",
  debug: "text-neutral-500",
};

export function PlayerDebugOverlay() {
  let scrollRef: HTMLDivElement | undefined;

  createEffect(() => {
    capturedLogLines();
    if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight;
  });

  return (
    <div
      ref={scrollRef}
      class="fixed inset-y-0 left-0 z-[70] w-1/2 overflow-y-auto bg-black/70 p-3 text-left font-mono text-xs"
      data-testid="debug-overlay"
    >
      <For each={capturedLogLines()}>
        {(line) => (
          <p class={LEVEL_COLOR[line.level]}>
            [{line.level}] {line.text}
          </p>
        )}
      </For>
    </div>
  );
}
