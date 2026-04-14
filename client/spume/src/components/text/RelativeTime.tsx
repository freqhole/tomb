// self-updating relative time display
// adapts its refresh interval based on age:
//   < 1 hour:  every 60s
//   1h - 1d:   every 30 minutes
//   > 1 day:   no interval (static)

import { createEffect, createSignal, on, onCleanup } from "solid-js";

function formatRelative(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 30) return `${weeks}w ago`;
  return new Date(timestamp).toLocaleDateString();
}

function getInterval(timestamp: number): number | null {
  const age = Date.now() - timestamp;
  if (age < 3_600_000) return 60_000; // < 1 hour: tick every 60s
  if (age < 86_400_000) return 1_800_000; // < 1 day: tick every 30m
  return null; // > 1 day: static
}

export function RelativeTime(props: { timestamp: number; class?: string }) {
  const [text, setText] = createSignal(formatRelative(props.timestamp));
  let intervalId: ReturnType<typeof setInterval> | undefined;

  const setup = (ts: number) => {
    if (intervalId) clearInterval(intervalId);
    setText(formatRelative(ts));
    const ms = getInterval(ts);
    if (ms) {
      intervalId = setInterval(() => {
        setText(formatRelative(ts));
        // check if we should switch to a slower interval or stop
        const newMs = getInterval(ts);
        if (newMs !== ms) {
          setup(ts);
        }
      }, ms);
    }
  };

  createEffect(
    on(
      () => props.timestamp,
      (ts) => setup(ts)
    )
  );
  onCleanup(() => {
    if (intervalId) clearInterval(intervalId);
  });

  return <span class={props.class}>{text()}</span>;
}
