import { Show } from "solid-js";
import { DesktopArtistsView } from "./artists/DesktopArtistsView";
import { MobileArtistsView } from "./artists/MobileArtistsView";
import { useLayout } from "../../../store";
import type { RouteSectionProps } from "@solidjs/router";

interface ArtistSplitViewProps {
  class?: string;
}

export function ArtistSplitView(
  props: RouteSectionProps<unknown> & ArtistSplitViewProps = {} as any
) {
  const [layout] = useLayout();

  return (
    <div class={`h-full ${props.class || ""}`}>
      {/* Desktop View */}
      <Show when={layout.breakpoint === "desktop"}>
        <DesktopArtistsView class={props.class} />
      </Show>

      {/* Mobile View */}
      <Show
        when={layout.breakpoint === "mobile" || layout.breakpoint === "tablet"}
      >
        <MobileArtistsView class={props.class} />
      </Show>
    </div>
  );
}
