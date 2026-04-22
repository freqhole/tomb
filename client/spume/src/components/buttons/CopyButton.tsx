// reusable copy-to-clipboard button.
//
// flashes "copied!" in green for 5 seconds after a successful clipboard
// write. accepts either a static `text` string or an async `getText`
// function (used when the value is computed lazily, e.g. an account-link
// generator). on failure shows a toast and resets to the idle label.

import { createSignal, onCleanup } from "solid-js";
import { toast } from "../feedback/Toast";

export interface CopyButtonProps {
  /** static value to copy. one of `text` or `getText` is required. */
  text?: string;
  /** lazily compute the value to copy (e.g. fetch then copy). */
  getText?: () => Promise<string>;
  /** idle button label (default: "copy") */
  label?: string;
  /** label shown for 5s after a successful copy (default: "copied!") */
  copiedLabel?: string;
  /** label shown while `getText` is in flight (default: "...") */
  pendingLabel?: string;
  title?: string;
  variant?: "default" | "primary";
  disabled?: boolean;
  /** override the default tailwind class string entirely */
  class?: string;
}

export function CopyButton(props: CopyButtonProps) {
  const [state, setState] = createSignal<"idle" | "pending" | "copied">("idle");
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  const handle = async () => {
    if (state() === "pending") return;
    setState("pending");
    try {
      const text = props.text ?? (await props.getText!());
      await navigator.clipboard.writeText(text);
      setState("copied");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setState("idle"), 5000);
    } catch (e) {
      setState("idle");
      toast.error(`copy failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const label = () => {
    if (state() === "copied") return props.copiedLabel ?? "copied!";
    if (state() === "pending") return props.pendingLabel ?? "...";
    return props.label ?? "copy";
  };

  const baseClasses =
    props.class ??
    "px-2 py-1 text-xs font-medium rounded border transition-all duration-150 disabled:opacity-50 active:scale-95";
  const styleClasses = () => {
    if (state() === "copied") {
      return "bg-green-600/20 border-green-600/40 text-green-400 hover:bg-green-600/30";
    }
    if (props.variant === "primary") {
      return "bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white border-transparent";
    }
    return "bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border-[var(--color-border-subtle)]";
  };

  return (
    <button
      class={`${baseClasses} ${styleClasses()}`}
      onClick={handle}
      title={props.title}
      disabled={props.disabled || state() === "pending"}
    >
      {label()}
    </button>
  );
}
