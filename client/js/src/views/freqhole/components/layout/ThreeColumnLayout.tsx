import { Show, createSignal } from "solid-js";
import { useLayout, storeActions } from "../../store";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { Navigation } from "../navigation/Navigation";
import { Content } from "../content/Content";
import { Queue } from "../queue/Queue";
import { PlayerWrapper } from "../player/PlayerWrapper";
import { ContextMenuManager } from "../ui/ContextMenuManager";
import { NavigationHeader } from "../navigation/NavigationHeader";
import { FreqholeIcon, MenuIcon } from "../ui/icons";
import { AuthModal } from "../auth/AuthModal";

export function ThreeColumnLayout(props: any) {
  const [layout] = useLayout();
  const events = useGlobalEvents();
  const [mobileNavOpen, setMobileNavOpen] = createSignal(false);
  const [authOpen, setAuthOpen] = createSignal(false);

  // Responsive layout logic
  const columnClasses = () => {
    const { queueOpen, breakpoint } = layout;

    if (breakpoint === "mobile") return "grid-cols-1";
    if (breakpoint === "tablet")
      return "grid-cols-12 [&>*:nth-child(1)]:col-span-4 [&>*:nth-child(2)]:col-span-8";

    return queueOpen
      ? "grid-cols-12 [&>*:nth-child(1)]:col-span-3 [&>*:nth-child(2)]:col-span-6 [&>*:nth-child(3)]:col-span-3"
      : "grid-cols-12 [&>*:nth-child(1)]:col-span-3 [&>*:nth-child(2)]:col-span-9";
  };

  // Listen for queue toggle events
  events.on("queue:toggle", () => {
    storeActions.toggleQueue();
  });

  // Mobile navigation handlers
  const handleMobileNavToggle = () => {
    setMobileNavOpen(!mobileNavOpen());
  };

  const handleMobileNavClose = () => {
    setMobileNavOpen(false);
  };

  return (
    <div class="h-screen flex flex-col bg-black text-white font-sans">
      {/* Mobile Header - Sticky */}
      <div class="md:hidden sticky top-0 z-40 bg-black/90 backdrop-blur-xl">
        <div class="flex items-center justify-between px-4 py-3">
          {/* Logo with Menu Button */}
          <div class="flex items-center gap-2 justify-sapce-between">
            <span class="text-2xl font-light text-white lowercase">
              <span>freqh</span>
              <FreqholeIcon class="inline" />
              <span>le</span>
            </span>
          </div>

          {/* Hamburger Menu */}
          <button
            class="p-2 text-white hover:text-magenta-400 transition-colors"
            onClick={handleMobileNavToggle}
            title="Menu"
          >
            <MenuIcon className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Mobile Navigation Overlay */}
      <Show when={mobileNavOpen()}>
        <div
          class="md:hidden fixed inset-0 z-50 bg-black/50"
          onClick={handleMobileNavClose}
        >
          <div class="absolute left-0 top-0 bottom-0 bg-black/95 backdrop-blur-xl border-r border-magenta-800/30 transform transition-transform duration-300 animate-slideInLeft">
            <div class="flex items-center justify-between px-4 py-3">
              <div class="flex items-center gap-2">
                <span class="text-2xl font-light text-white lowercase">
                  <span>freqh</span>
                  <FreqholeIcon class="inline" />
                  <span>le</span>
                </span>
              </div>
              <button
                class="p-2 text-white hover:text-magenta-400 transition-colors"
                onClick={handleMobileNavClose}
                title="Close"
              >
                <svg
                  class="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div class="h-full overflow-y-auto pb-20">
              <Navigation />
            </div>
          </div>
        </div>
      </Show>

      {/* Desktop Layout */}
      <div class={`hidden md:grid ${columnClasses()} h-full pb-20`}>
        {/* Navigation Column */}
        <div class="h-full overflow-y-auto">
          <Navigation />
        </div>

        {/* Content Column */}
        <div class="h-full overflow-y-auto">
          <Content>{props.children}</Content>
        </div>

        {/* Queue Column (conditional) */}
        <Show when={layout.queueOpen}>
          <div class="h-full overflow-y-auto">
            <Queue />
          </div>
        </Show>
      </div>

      {/* Mobile Single Column Layout */}
      <div class="md:hidden flex-1 overflow-hidden pb-20 w-full max-w-full">
        <Show when={!mobileNavOpen()}>
          <Show when={!layout.queueOpen}>
            <div class="h-full overflow-y-auto w-full max-w-full">
              <Content>{props.children}</Content>
            </div>
          </Show>
          <Show when={layout.queueOpen}>
            <div class="h-full overflow-y-auto w-full max-w-full">
              <Queue />
            </div>
          </Show>
        </Show>
      </div>

      {/* Fixed Footer Player */}
      <div class="fixed bottom-0 left-0 right-0 z-50">
        <PlayerWrapper />
      </div>

      {/* Global Context Menu */}
      <ContextMenuManager />

      {/* auth model */}
      <AuthModal isOpen={authOpen()} onClose={() => setAuthOpen(false)} />
    </div>
  );
}
