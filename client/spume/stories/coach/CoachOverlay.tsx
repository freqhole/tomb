// scroll-coach demo — tooltip overlay
//
// renders the active step's tooltip near its data-coach-anchor target,
// plus a progress dot strip at the bottom and prev/next buttons.
//
// stub: positioning logic is a simple bounding-rect query. swap for a
// proper anchor lib later if needed.

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { coachSteps } from "./script";
import { currentStep, goToStep, next, prev } from "./coachState";

export interface CoachOverlayProps {
  /** root element (or shadow root) to query for [data-coach-anchor]. defaults to document. */
  root?: HTMLElement | ShadowRoot | Document;
  /** show prev/next buttons. defaults to true (off when host drives via scroll). */
  showControls?: boolean;
  /** show progress dots. defaults to true. */
  showDots?: boolean;
  /** show the in-frame tooltip card. defaults to true. set false when the host renders step copy outside the frame. */
  showTooltip?: boolean;
}

export function CoachOverlay(props: CoachOverlayProps) {
  const [anchorRect, setAnchorRect] = createSignal<DOMRect | null>(null);

  const showControls = () => props.showControls !== false;
  const showDots = () => props.showDots !== false;
  const showTooltip = () => props.showTooltip !== false;

  const measure = () => {
    const step = coachSteps[currentStep()];
    if (!step) return setAnchorRect(null);
    if (step.anchor === "stage") return setAnchorRect(null);
    const root = props.root ?? document;
    const el = root.querySelector(`[data-coach-anchor="${step.anchor}"]`) as HTMLElement | null;
    setAnchorRect(el?.getBoundingClientRect() ?? null);
  };

  createEffect(() => {
    // depend on currentStep so we re-measure on step change
    void currentStep();
    requestAnimationFrame(measure);
  });

  const onResize = () => requestAnimationFrame(measure);
  if (typeof window !== "undefined") {
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    onCleanup(() => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    });
  }

  const tooltipStyle = () => {
    const r = anchorRect();
    if (!r) {
      // centered overlay for stage steps
      return {
        position: "fixed" as const,
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        "max-width": "320px",
      };
    }
    // place below the anchor by default; flip if not enough room
    const spaceBelow = window.innerHeight - r.bottom;
    const above = spaceBelow < 160;
    return {
      position: "fixed" as const,
      top: above ? `${r.top - 12}px` : `${r.bottom + 12}px`,
      left: `${Math.max(12, Math.min(window.innerWidth - 332, r.left))}px`,
      transform: above ? "translateY(-100%)" : "none",
      "max-width": "320px",
    };
  };

  const step = () => coachSteps[currentStep()];

  return (
    <>
      <Show when={showTooltip() && step()}>
        {(s) => (
          <div
            class="z-[10000] pointer-events-auto rounded-lg border border-[var(--color-border-default,#333)] bg-[var(--color-bg-elevated,#1a1a1a)] text-[var(--color-text-primary,#fff)] shadow-xl p-4"
            style={tooltipStyle()}
            role="dialog"
            aria-label={s().title}
          >
            <div class="text-sm font-semibold mb-1">{s().title}</div>
            <div class="text-xs text-[var(--color-text-secondary,#aaa)] leading-snug">
              {s().body}
            </div>
            <Show when={showControls()}>
              <div class="flex items-center justify-between mt-3 gap-2">
                <button
                  type="button"
                  class="text-xs px-2 py-1 rounded bg-[var(--color-bg-secondary,#222)] hover:bg-[var(--color-bg-hover,#2a2a2a)] disabled:opacity-40"
                  onClick={() => prev()}
                  disabled={currentStep() <= 0}
                >
                  ← prev
                </button>
                <span class="text-[10px] text-[var(--color-text-tertiary,#888)]">
                  {currentStep() + 1} / {coachSteps.length}
                </span>
                <button
                  type="button"
                  class="text-xs px-2 py-1 rounded bg-[var(--color-accent-500,#d63384)]/20 text-[var(--color-accent-500,#d63384)] hover:bg-[var(--color-accent-500,#d63384)]/30 disabled:opacity-40"
                  onClick={() => next()}
                  disabled={currentStep() >= coachSteps.length - 1}
                >
                  next →
                </button>
              </div>
            </Show>
          </div>
        )}
      </Show>

      <Show when={showDots()}>
        <div
          class="fixed left-1/2 -translate-x-1/2 z-[9999] flex gap-1.5"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }}
        >
          <For each={coachSteps}>
            {(s, i) => (
              <button
                type="button"
                aria-label={`step ${i() + 1}: ${s.title}`}
                onClick={() => goToStep(i())}
                class="w-2 h-2 rounded-full transition-all"
                classList={{
                  "bg-[var(--color-accent-500,#d63384)] w-4": i() === currentStep(),
                  "bg-white/30 hover:bg-white/60": i() !== currentStep(),
                }}
              />
            )}
          </For>
        </div>
      </Show>
    </>
  );
}
