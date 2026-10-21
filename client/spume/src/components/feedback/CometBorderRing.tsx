// wraps any pill/rounded-rect-shaped child in an animated "comet trail"
// loading ring that traces its actual border (rather than a plain circle),
// extracted from the queue "play on" picker (see QueuePlayerTargetRow.tsx).
//
// a rotating conic-gradient (used for the app's other loading rings) only
// moves at constant *angular* speed, which looks correct on a circle but
// visibly uneven on a wide pill - the "head" races across the flat edges
// and crawls around the rounded ends. instead this animates stroke-dashoffset
// on an SVG rect (pathLength="100" normalizes so dash math is aspect-ratio
// independent) - that moves at constant speed along the actual perimeter no
// matter the shape.
//
// the ring is sized off a ResizeObserver measurement of the wrapped child's
// real rendered box (rather than assuming a sibling CSS box coincidentally
// matches it), so it hugs the child's exact border regardless of intervening
// wrapper markup/padding.
import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";

// the entire trail, not each band, occupies this fraction of the long axis.
const TAIL_LENGTH_RATIO = 0.3;

const COMET_BANDS = [
  { color: "#ec4899", opacity: 1 },
  { color: "#ec4899", opacity: 0.85 },
  { color: "#ec4899", opacity: 0.7 },
  { color: "#c026d3", opacity: 0.58 },
  { color: "#c026d3", opacity: 0.46 },
  { color: "#c026d3", opacity: 0.34 },
  { color: "#a855f7", opacity: 0.24 },
  { color: "#a855f7", opacity: 0.16 },
  { color: "#a855f7", opacity: 0.09 },
  { color: "#a855f7", opacity: 0.04 },
];

export interface CometBorderRingProps {
  /** whether the ring is shown (default: true) */
  active?: boolean;
  /** extra classes for the outer wrapping container */
  class?: string;
  children: JSX.Element;
}

export function CometBorderRing(props: CometBorderRingProps) {
  let contentRef: HTMLDivElement | undefined;
  const [size, setSize] = createSignal({ width: 0, height: 0 });

  onMount(() => {
    if (!contentRef) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(contentRef);
    onCleanup(() => observer.disconnect());
  });

  const isActive = () => (props.active ?? true) && size().width > 0 && size().height > 0;
  const radius = () => Math.min(size().width, size().height) / 2;
  // "diameter" here means the pill's long axis (the dimension it spans
  // across), not its short/rounded-cap side - a trail sized off the short
  // side would shrink toward nothing on a wide, elongated pill.
  const diameter = () => Math.max(size().width, size().height);
  // pathLength="100" below normalizes dasharray units to a percentage of
  // the actual rendered perimeter, so convert the target px length back
  // into that same percentage scale.
  const perimeter = () => {
    const r = radius();
    return 2 * (size().width - 2 * r) + 2 * (size().height - 2 * r) + 2 * Math.PI * r;
  };
  const tailLength = () =>
    perimeter() > 0 ? (TAIL_LENGTH_RATIO * diameter() * 100) / perimeter() : 0;
  const bandLength = () => tailLength() / COMET_BANDS.length;

  return (
    <div class={`relative inline-flex ${props.class ?? ""}`}>
      <Show when={isActive()}>
        <svg
          class="absolute inset-0 pointer-events-none"
          style={{ overflow: "visible" }}
          width={size().width}
          height={size().height}
        >
          <For each={COMET_BANDS}>
            {(band, index) => (
              <rect
                x="0"
                y="0"
                width={size().width}
                height={size().height}
                rx={radius()}
                ry={radius()}
                fill="none"
                stroke={band.color}
                stroke-width="3"
                stroke-linecap="round"
                pathLength="100"
                style={{
                  "stroke-dasharray": `${bandLength()} ${100 - bandLength()}`,
                  opacity: String(band.opacity),
                  animation: "comet-dash 1.5s linear infinite",
                  "animation-delay": `${-1.5 + (index() * bandLength() * 1.5) / 100}s`,
                }}
              />
            )}
          </For>
        </svg>
      </Show>
      <div ref={contentRef} class="inline-flex">
        {props.children}
      </div>
    </div>
  );
}
