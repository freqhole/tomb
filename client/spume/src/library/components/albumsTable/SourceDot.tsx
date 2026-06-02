export type SourceBadgeState = "missing" | "ok" | "error" | "inflight";

// SourceDot: tiny colored circle + label for last.fm / theaudiodb availability.
// deliberately non-pill (no background box) so it can't be confused with the mb chip.
export function SourceDot(props: { label: string; state: SourceBadgeState }) {
  const tooltip = () => {
    switch (props.state) {
      case "inflight":
        return `${props.label}: looking up…`;
      case "ok":
        return `${props.label}: fetched`;
      case "error":
        return `${props.label}: error (see modal)`;
      case "missing":
        return `${props.label}: not fetched`;
    }
  };
  return (
    <span
      class="inline-flex items-center gap-0.5 text-[9px] text-[var(--color-text-disabled)]"
      title={tooltip()}
    >
      <span
        class="inline-block w-1.5 h-1.5 rounded-full"
        classList={{
          "bg-blue-400 animate-pulse": props.state === "inflight",
          "bg-emerald-500": props.state === "ok",
          "bg-rose-500": props.state === "error",
          "bg-[var(--color-border-subtle)]": props.state === "missing",
        }}
      />
      {props.label}
    </span>
  );
}
