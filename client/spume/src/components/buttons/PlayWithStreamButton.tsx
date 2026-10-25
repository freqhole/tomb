// wraps a primary "play" button so it opens a flyout of extra options
// (stream to a radio station) whenever any exist - the whole button is
// always the same single click target, never a separate merged caret/
// split button: with no extra options, clicking it just plays, same as
// before this feature existed; with extra options, clicking it opens a
// menu whose first entry is "play" (or whatever the current label is)
// followed by the extra ones, rather than silently guessing which one
// the user wanted - a small trailing chevron on the button itself is
// the only visual change, a hint that it has more to offer, not a
// second click zone. the flyout itself is `ClickDropdownMenu` (see
// ContextMenu.tsx) - the project's existing proven position:fixed +
// portal dropdown pattern (see docs/topnav-kobalte-removal-plan.md), not
// a hand-rolled one - it already handles viewport-edge clamping/flipping
// and doesn't clip inside a scrolled/overflow-hidden ancestor the way a
// plain `position: absolute` dropdown can.
//
// the caret/flyout never appears at all when there's nothing extra to
// offer - no compatible/accepting station, or the video is already
// available locally (see useStreamFlyoutActions.ts's `alreadyLocal`) -
// a video that's already local just plays, no radio station stuff needed.
//
// the per-season mini play buttons use `useStreamFlyoutActions` +
// `ClickDropdownMenu` directly with their own compact icon-button
// trigger instead of this component - see VideoSeriesDetailPanel.tsx.
import { createMemo, Show, type Accessor } from "solid-js";
import { Button, type ButtonProps } from "./Button";
import { ClickDropdownMenu, type MenuAction } from "../overlays/ContextMenu";
import { Icon } from "../icons/registry";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { useStreamFlyoutActions } from "../radio/useStreamFlyoutActions";
import { type RequestQueueItem } from "../radio/requestStation";

export interface PlayWithStreamButtonProps {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
  variant?: ButtonProps["variant"];
  class?: string;
  remote: Accessor<Remote | null>;
  resolveStreamItems: () => Promise<RequestQueueItem[] | null>;
  streamLabel: string;
  /** true when the video that would actually start playing is already
   *  available locally - hides the whole flyout (see
   *  useStreamFlyoutActions.ts's `alreadyLocal` doc comment). */
  alreadyLocal?: () => boolean;
}

export function PlayWithStreamButton(props: PlayWithStreamButtonProps) {
  const { showCaret, menuActions } = useStreamFlyoutActions({
    remote: () => props.remote(),
    resolveStreamItems: () => props.resolveStreamItems(),
    streamLabel: () => props.streamLabel,
    alreadyLocal: () => props.alreadyLocal?.() ?? false,
  });

  // the trigger button's own click behavior never changes based on
  // whether a menu exists - only a small trailing chevron appears when
  // one does, so a glance at the button tells you it has more to offer
  // (see docs/backlog-video.md's item #3 writeup for why this isn't a
  // two-click-zone split button: there's still exactly one click
  // target). no onClick here: ClickDropdownMenu's own wrapping trigger
  // div owns the click when a menu applies (see the `Show` branch
  // below) - "play" itself becomes the menu's own first action instead.
  const triggerButton = () => (
    <Button
      variant={props.variant ?? "primary"}
      loading={props.loading}
      disabled={props.disabled}
      class={props.class}
    >
      <span class="inline-flex items-center gap-1">
        {props.label}
        <Icon name="chevronDown" size={12} />
      </span>
    </Button>
  );

  const allActions = createMemo((): MenuAction[] => [
    { label: props.label, icon: "play", onClick: props.onClick, disabled: props.disabled },
    ...menuActions(),
  ]);

  return (
    <Show
      when={showCaret()}
      fallback={
        <Button
          variant={props.variant ?? "primary"}
          loading={props.loading}
          disabled={props.disabled}
          onClick={props.onClick}
          class={props.class}
        >
          {props.label}
        </Button>
      }
    >
      <ClickDropdownMenu trigger={triggerButton()} actions={allActions()} align="left" />
    </Show>
  );
}

export default PlayWithStreamButton;
