// view selector - hover flyout to switch between main views
import { createSignal, For, Show, onCleanup } from "solid-js";
import { ChevronDownStrokeIcon } from "../icons/registry";

export interface ViewOption {
  label: string;
  path: string;
  count?: number;
}

export interface ViewSelectorProps {
  views: ViewOption[];
  currentTitle?: string;
  currentCount?: number;
  onNavigate: (path: string) => void;
}

export function ViewSelector(props: ViewSelectorProps) {
  const [open, setOpen] = createSignal(false);
  const [locked, setLocked] = createSignal(false);
  let closeTimeout: ReturnType<typeof setTimeout> | undefined;
  let containerRef: HTMLDivElement | undefined;

  const handleMouseEnter = () => {
    clearTimeout(closeTimeout);
    if (!open()) setOpen(true);
  };

  const handleMouseLeave = () => {
    if (locked()) return;
    closeTimeout = setTimeout(() => setOpen(false), 150);
  };

  const handleClick = () => {
    if (open() && locked()) {
      // already locked open — close and unlock
      setLocked(false);
      setOpen(false);
    } else {
      // either closed, or hover-open but not locked — lock open
      setOpen(true);
      setLocked(true);
    }
  };

  // close on click outside
  const handleClickOutside = (e: MouseEvent) => {
    if (containerRef && !containerRef.contains(e.target as Node)) {
      setOpen(false);
      setLocked(false);
    }
  };

  document.addEventListener("click", handleClickOutside);
  onCleanup(() => {
    document.removeEventListener("click", handleClickOutside);
    clearTimeout(closeTimeout);
  });

  const currentView = () => props.views.find((v) => v.label === props.currentTitle) || null;

  return (
    <div
      ref={containerRef}
      class="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* trigger button */}
      <button
        class="flex items-center gap-1.5 px-2 py-1 text-sm text-white/80 hover:text-white transition-colors border-none bg-transparent cursor-pointer rounded hover:bg-white/10"
        onClick={handleClick}
      >
        <span class={`transition-transform ${open() ? "rotate-180" : ""}`}>
          <ChevronDownStrokeIcon size={12} />
        </span>
        <span class="font-medium">{props.currentTitle || "navigate"}</span>
        <Show when={props.currentCount !== undefined}>
          <span class="text-white/40">({props.currentCount})</span>
        </Show>
      </button>

      {/* flyout menu */}
      <Show when={open()}>
        <div class="absolute top-full left-0 mt-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-xl z-[1001] min-w-[180px] py-1 px-4">
          <For each={props.views}>
            {(view) => {
              const isActive = () => view.label === props.currentTitle;
              return (
                <button
                  class="w-full text-left px-3 py-2 text-sm transition-colors border-none bg-transparent cursor-pointer flex items-center justify-between gap-3"
                  classList={{
                    "text-[var(--color-accent-500)] bg-[var(--color-accent-500)]/10": isActive(),
                    "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)]":
                      !isActive(),
                  }}
                  onClick={() => {
                    props.onNavigate(view.path);
                    setOpen(false);
                  }}
                >
                  <span>{view.label}</span>
                  <Show when={view.count !== undefined}>
                    <span class="text-xs text-[var(--color-text-tertiary)]">{view.count}</span>
                  </Show>
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
