import { Show } from "solid-js";
import { useLayout, storeActions } from "../../store";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import { Navigation } from "../navigation/Navigation";
import { Content } from "../content/Content";
import { Queue } from "../queue/Queue";
import { PlayerWrapper } from "../player/PlayerWrapper";

export function ThreeColumnLayout(props: any) {
  const [layout] = useLayout();
  const events = useGlobalEvents();

  // Responsive layout logic
  const columnClasses = () => {
    const { queueOpen, breakpoint } = layout;

    if (breakpoint === "mobile") return "grid-cols-1";
    if (breakpoint === "tablet")
      return "grid-cols-12 [&>*:nth-child(1)]:col-span-4 [&>*:nth-child(2)]:col-span-8";

    return queueOpen
      ? "grid-cols-12 [&>*:nth-child(1)]:col-span-3 [&>*:nth-child(2)]:col-span-6 [&>*:nth-child(3)]:col-span-3"
      : "grid-cols-12 [&>*:nth-child(1)]:col-span-4 [&>*:nth-child(2)]:col-span-8";
  };

  // Listen for queue toggle events
  events.on("queue:toggle", () => {
    storeActions.toggleQueue();
  });

  return (
    <div class="h-screen flex flex-col bg-black text-white font-sans">
      <div class={`grid flex-1 ${columnClasses()}`}>
        {/* Navigation Column */}
        <Navigation />

        {/* Content Column */}
        <Content>{props.children}</Content>

        {/* Queue Column (conditional) */}
        <Show when={layout.queueOpen}>
          <Queue />
        </Show>
      </div>

      {/* Footer Player */}
      <PlayerWrapper />
    </div>
  );
}
