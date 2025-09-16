import { useLocation } from "@solidjs/router";
import { storeActions } from "../../store";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { useSafeNavigate } from "../../../../lib/navigation";
import { NavigationHeader } from "./NavigationHeader";
import { NavigationSections } from "./NavigationSections";
import { PlaylistsNavigation } from "./PlaylistsNavigation";
import { isMobile } from "../../../../lib/format-utils";

export function Navigation() {
  const navigate = useSafeNavigate();
  const location = useLocation();

  const events = useGlobalEvents();

  // Listen for navigation events
  events.on("nav:change", ({ view }) => {
    storeActions.setCurrentView(view as any);
    navigate(view);
  });

  return (
    <div class="flex flex-col h-full bg-black/80">
      <NavigationHeader />

      <div class={`flex-1 overflow-y-auto${isMobile() ? " mb-20" : ""}`}>
        <NavigationSections
          currentPath={location.pathname}
          onNavigate={navigate}
        />

        <PlaylistsNavigation
          currentPath={location.pathname}
          onNavigate={navigate}
        />
      </div>
    </div>
  );
}
