import { Show, createSignal } from "solid-js";
import { useLayout, storeActions } from "../../store";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { Navigation } from "../navigation/Navigation";
import { Content } from "../content/Content";
import { Queue } from "../queue/Queue";
import { PlayerWrapper } from "../player/PlayerWrapper";
import { ContextMenuManager } from "../ui/ContextMenuManager";

import { FreqholeIcon, MenuIcon } from "../ui/icons";
import { AuthModal } from "../auth/AuthModal";
import { SongInfoModal } from "../modals/SongInfoModal";

import type { Song } from "../../../../lib/music/schemas/song";
import { UserMenu } from "../auth/UserMenu";
import { useAuth } from "../../../../hooks/auth";
import { isMobile } from "../../../../lib/format-utils";

export function ThreeColumnLayout(props: any) {
  const [layout] = useLayout();
  const events = useGlobalEvents();
  const [mobileNavOpen, setMobileNavOpen] = createSignal(false);
  const [authOpen, setAuthOpen] = createSignal(false);
  const [songInfoOpen, setSongInfoOpen] = createSignal(false);
  const [songInfoData, setSongInfoData] = createSignal<Song[]>([]);

  const auth = useAuth();

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

  // Listen for modal events
  events.on("modal:open", ({ modal, data }) => {
    if (modal === "songInfoModal" && data?.songs) {
      setSongInfoData(data.songs);
      setSongInfoOpen(true);
    }
    if (modal === "musicbrainzModal" && data?.songs) {
      setSongInfoData(data.songs);
      setSongInfoOpen(true);
    }
  });

  events.on("modal:close", ({ modal }) => {
    if (modal === "songInfoModal") {
      setSongInfoOpen(false);
    }
    if (modal === "musicbrainzModal") {
      setSongInfoOpen(false);
    }
  });

  // Listen for musicbrainz modal events
  events.on("musicbrainz-modal:open", ({ songs }) => {
    setSongInfoData(songs);
    setSongInfoOpen(true);
  });

  events.on("musicbrainz-modal:close", () => {
    setSongInfoOpen(false);
    setSongInfoData([]);
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

          <div class="flex-grow">&nbsp;</div>

          <Show
            when={auth.isAuthenticated}
            fallback={
              <button
                onClick={() => setAuthOpen(true)}
                class="p-2 text-gray-400 hover:text-white transition-colors rounded-full hover:bg-magenta-600/20"
                title="sign in"
              >
                <svg
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
              </button>
            }
          >
            <UserMenu />
          </Show>

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

      <Show when={!isMobile()}>
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
      </Show>
      <Show when={isMobile()}>
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
      </Show>

      {/* Fixed Footer Player */}
      <div class="fixed bottom-0 left-0 right-0 z-50">
        <PlayerWrapper />
      </div>

      {/* Global Context Menu */}
      <ContextMenuManager />

      {/* auth modal */}
      <AuthModal isOpen={authOpen()} onClose={() => setAuthOpen(false)} />

      {/* song info modal */}
      <SongInfoModal
        isOpen={songInfoOpen()}
        onClose={() => setSongInfoOpen(false)}
        songs={songInfoData()}
      />
    </div>
  );
}
