import { JSX, Show, createSignal, onMount } from "solid-js";

export interface PanelProps {
  title?: string;
  subtitle?: string;
  children: JSX.Element;
  isLoading?: boolean;
  isEmpty?: boolean;
  emptyMessage?: string;
  className?: string;
  headerActions?: JSX.Element;
  onScrollEnd?: () => void;
  scrollThreshold?: number;
}

export function Panel(props: PanelProps) {
  const [scrollContainer, setScrollContainer] = createSignal<HTMLDivElement>();

  onMount(() => {
    const container = scrollContainer();
    if (!container || !props.onScrollEnd) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const threshold = props.scrollThreshold || 100;

      if (scrollHeight - scrollTop - clientHeight < threshold) {
        props.onScrollEnd?.();
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  });

  return (
    <div class={`flex flex-col h-full bg-black ${props.className || ""}`}>
      {/* Header */}
      <Show when={props.title || props.headerActions}>
        <div class="flex-shrink-0 p-4">
          <div class="flex items-center justify-between">
            <div>
              <Show when={props.title}>
                <h2 class="text-sm font-medium text-gray-400 mb-1">
                  {props.title}
                </h2>
              </Show>
              <Show when={props.subtitle}>
                <p class="text-xs text-gray-500">{props.subtitle}</p>
              </Show>
            </div>
            <Show when={props.headerActions}>
              <div class="flex items-center space-x-2">
                {props.headerActions}
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* Content Area */}
      <div ref={setScrollContainer} class="flex-1 overflow-y-auto">
        <Show when={!props.isLoading} fallback={<LoadingState />}>
          <Show
            when={!props.isEmpty}
            fallback={<EmptyState message={props.emptyMessage} />}
          >
            <div class="p-4">{props.children}</div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div class="p-4 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          class="h-12 bg-dark-300 rounded loading-shimmer"
          style={{ "animation-delay": `${i * 0.1}s` }}
        />
      ))}
    </div>
  );
}

function EmptyState(props: { message?: string }) {
  return (
    <div class="flex flex-col items-center justify-center h-full text-center p-8">
      <div class="w-16 h-16 bg-dark-300 rounded-full flex items-center justify-center mb-4">
        <svg
          class="w-8 h-8 text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
      </div>
      <p class="text-gray-400 text-sm">
        {props.message || "No items to display"}
      </p>
    </div>
  );
}
