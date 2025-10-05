import { Show } from "solid-js";
import { DesktopGenresView } from "./genres/DesktopGenresView";
import { useLayout } from "../../../store";
import type { RouteSectionProps } from "@solidjs/router";

interface GenreSplitViewProps {
  class?: string;
}

export function GenreSplitView(
  props: RouteSectionProps<unknown> & GenreSplitViewProps = {} as any
) {
  const [layout] = useLayout();

  return (
    <div class={`h-full w-full ${props.class || ""}`}>
      <Show when={layout.breakpoint === "desktop"}>
        <DesktopGenresView class={props.class} />
      </Show>
      <Show when={layout.breakpoint !== "desktop"}>
        {/* TODO: Implement MobileGenresView in Phase 5 */}
        <DesktopGenresView class={props.class} />
      </Show>
    </div>
  );
}
