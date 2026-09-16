// devel-mode debug overlay for spume's /player/ route: a big, transparent,
// scrollable panel rendering every captured console.* line (see cenotaph's
// debug/consoleCapture.ts doc comment for why - no devtools access on tvs/
// embedded browsers). only rendered by CenotaphPlayerApp while develMode()
// is on. mirrors player.freqhole.net's now-abandoned `debug/DebugOverlay.tsx`.

import { createEffect, createSignal, For } from "solid-js";
import { capturedLogLines, type CapturedLogLine } from "../index";

const LEVEL_COLOR: Record<CapturedLogLine["level"], string> = {
  log: "text-neutral-300",
  info: "text-blue-300",
  warn: "text-yellow-300",
  error: "text-red-400",
  debug: "text-neutral-500",
};

export function PlayerDebugOverlay() {
  let scrollRef: HTMLDivElement | undefined;
  const [copied, setCopied] = createSignal(false);

  createEffect(() => {
    capturedLogLines();
    if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight;
  });

  // no devtools on tvs/embedded browsers (this overlay's whole reason to
  // exist) means no other way to get these lines off the device at all.
  const handleCopy = async () => {
    const text = capturedLogLines()
      .map((line) => `[${line.level}] ${line.text}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // no toast surface here - the copied-state flash is the only feedback available
    }
  };

  return (
    <div
      class="fixed inset-y-0 left-0 z-[70] flex w-1/2 flex-col bg-black/70 text-left font-mono text-xs"
      data-testid="debug-overlay"
    >
      <div class="flex flex-shrink-0 justify-end p-2">
        <button
          type="button"
          class="rounded border border-white/30 bg-black/60 px-2 py-1 font-sans text-[10px] text-white hover:bg-black/80"
          onClick={() => void handleCopy()}
          data-testid="debug-overlay-copy"
        >
          {copied() ? "copied!" : "copy all"}
        </button>
      </div>
      <div ref={scrollRef} class="flex-1 overflow-y-auto p-3 pt-0">
        <For each={capturedLogLines()}>
          {(line) => (
            <p class={LEVEL_COLOR[line.level]}>
              [{line.level}] {line.text}
            </p>
          )}
        </For>
      </div>
    </div>
  );
}
