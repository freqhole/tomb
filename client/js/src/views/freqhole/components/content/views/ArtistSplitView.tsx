import { DesktopArtistsView } from "./artists/DesktopArtistsView";
import { MobileArtistsView } from "./artists/MobileArtistsView";
import type { RouteSectionProps } from "@solidjs/router";

interface ArtistSplitViewProps {
  class?: string;
}

export function ArtistSplitView(
  props: RouteSectionProps<unknown> & ArtistSplitViewProps = {} as any
) {
  return (
    <div class={`h-full ${props.class || ""}`}>
      {/* Desktop View */}
      <div class="hidden md:block h-full">
        <DesktopArtistsView class={props.class} />
      </div>

      {/* Mobile View */}
      <div class="md:hidden h-full">
        <MobileArtistsView class={props.class} />
      </div>
    </div>
  );
}
