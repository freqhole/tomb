// action bar for bulk song operations - appears at bottom of viewport when 2+ songs selected

import { Show, createSignal, createEffect, on, onMount, onCleanup } from "solid-js";
import { Button } from "../buttons/Button";
import { Icon, IconNames } from "../icons/registry";

export interface SelectionActionBarProps {
  /** number of selected songs */
  count: number;
  /** whether player bar is showing (affects positioning) */
  hasPlayerBar: boolean;
  /** optional container element ref to center the bar within */
  containerRef?: HTMLElement;
  /** called when edit artist/album button clicked */
  onEditMetadata: () => void;
  /** called when set disc number button clicked */
  onSetDiscNumber: () => void;
  /** called when delete images button clicked */
  onDeleteImages: () => void;
  /** called when add to playlist button clicked */
  onAddToPlaylist: () => void;
  /** called when add to queue button clicked */
  onAddToQueue: () => void;
  /** called when delete songs button clicked */
  onDeleteSongs: () => void;
  /** called when clear selection button clicked */
  onClearSelection: () => void;
}

export function SelectionActionBar(props: SelectionActionBarProps) {
  // only show when 2+ selected
  const shouldShow = () => props.count >= 2;

  // track visibility for animation
  const [isVisible, setIsVisible] = createSignal(false);
  const [isAnimating, setIsAnimating] = createSignal(false);

  // track container center position for centering within content area
  const [centerPosition, setCenterPosition] = createSignal<{ left: number; width: number } | null>(
    null
  );

  // update center position when container changes
  const updateCenterPosition = () => {
    if (props.containerRef) {
      const rect = props.containerRef.getBoundingClientRect();
      setCenterPosition({ left: rect.left, width: rect.width });
    } else {
      setCenterPosition(null);
    }
  };

  // use ResizeObserver to detect container size changes (e.g., queue panel open/close)
  let resizeObserver: ResizeObserver | undefined;

  onMount(() => {
    updateCenterPosition();
    window.addEventListener("resize", updateCenterPosition);

    // observe container for size changes
    if (props.containerRef) {
      resizeObserver = new ResizeObserver(() => {
        updateCenterPosition();
      });
      resizeObserver.observe(props.containerRef);
    }
  });

  onCleanup(() => {
    window.removeEventListener("resize", updateCenterPosition);
    resizeObserver?.disconnect();
  });

  // also update when containerRef changes
  createEffect(() => {
    if (props.containerRef) {
      updateCenterPosition();
      // reconnect observer to new container
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(() => {
        updateCenterPosition();
      });
      resizeObserver.observe(props.containerRef);
    }
  });

  // animate in when shouldShow becomes true, animate out when false
  createEffect(
    on(
      () => shouldShow(),
      (show) => {
        if (show) {
          setIsAnimating(true);
          // small delay to allow DOM to render before animating
          requestAnimationFrame(() => setIsVisible(true));
        } else {
          setIsVisible(false);
          // keep animating state true during exit animation
          setTimeout(() => setIsAnimating(false), 200);
        }
      }
    )
  );

  // render when animating or should show
  const shouldRender = () => shouldShow() || isAnimating();

  // calculate positioning style
  const positionStyle = () => {
    const pos = centerPosition();
    if (pos) {
      // center within the container
      return {
        left: `${pos.left + pos.width / 2}px`,
        transform: `translateX(-50%) translateY(${isVisible() ? "0" : "100%"})`,
      };
    }
    // fallback: center in viewport
    return {
      left: "50%",
      transform: `translateX(-50%) translateY(${isVisible() ? "0" : "100%"})`,
    };
  };

  return (
    <Show when={shouldRender()}>
      <div
        class="fixed z-40 flex items-center gap-2 px-4 py-3 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] shadow-lg rounded-t-lg transition-transform duration-200 ease-out"
        style={{
          bottom: props.hasPlayerBar ? "80px" : "0px",
          ...positionStyle(),
          "border-bottom": "none",
          "border-bottom-left-radius": "0",
          "border-bottom-right-radius": "0",
        }}
      >
        {/* selection count */}
        <div class="flex items-center gap-2 pr-4 border-r border-[var(--color-border-default)]">
          <span class="text-sm font-medium text-[var(--color-accent-500)] whitespace-nowrap">
            {props.count} selected
          </span>
        </div>

        {/* action buttons */}
        <div class="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={props.onEditMetadata}
            title="edit artist/album"
          >
            <Icon name={IconNames.edit} size={16} />
            <span class="ml-1 whitespace-nowrap">edit</span>
          </Button>

          <Button variant="ghost" size="sm" onClick={props.onSetDiscNumber} title="set disc number">
            <Icon name={IconNames.album} size={16} />
            <span class="ml-1 whitespace-nowrap">disc #</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={props.onDeleteImages}
            title="delete primary images"
          >
            <Icon name={IconNames.image} size={16} />
            <span class="ml-1 whitespace-nowrap">clear images</span>
          </Button>

          <Button variant="ghost" size="sm" onClick={props.onAddToPlaylist} title="add to playlist">
            <Icon name={IconNames.playlist} size={16} />
            <span class="ml-1 whitespace-nowrap">playlist</span>
          </Button>

          <Button variant="ghost" size="sm" onClick={props.onAddToQueue} title="add to queue">
            <Icon name={IconNames.queue} size={16} />
            <span class="ml-1 whitespace-nowrap">queue</span>
          </Button>
        </div>

        {/* danger zone */}
        <div class="flex items-center gap-1 pl-4 border-l border-[var(--color-border-default)]">
          <Button variant="danger" size="sm" onClick={props.onDeleteSongs} title="delete songs">
            <span class="whitespace-nowrap">delete</span>
          </Button>
        </div>

        {/* clear selection */}
        <div class="flex items-center gap-1 pl-4 border-l border-[var(--color-border-default)]">
          <Button
            variant="ghost"
            size="sm"
            onClick={props.onClearSelection}
            title="clear selection (Esc)"
          >
            <span class="whitespace-nowrap">clear</span>
          </Button>
        </div>
      </div>
    </Show>
  );
}
