// shared logic (no rendering) behind every "stream to a radio station"
// flyout on a play button - pulled out of PlayWithStreamButton.tsx so a
// differently-styled trigger (e.g. a tiny icon-button caret in a compact
// row, like the per-season mini play buttons, vs. a full button) can
// reuse the exact same station-pick/submit logic without duplicating it.
//
// deliberately stream-only, no "download"/"save to local library"
// option - per explicit ask, this flyout is purely about streaming to a
// radio station, never about fetching a local copy.
import { createMemo, createSignal, type Accessor } from "solid-js";
import { type MenuAction } from "../overlays/ContextMenu";
import { toast } from "../feedback/Toast";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { useStreamStation } from "./useStreamStation";
import { submitRequestAndTune, type RequestQueueItem } from "./requestStation";

export interface UseStreamFlyoutActionsProps {
  /** radio requires an active remote (even a charnel-managed "self" one)
   *  - the caret never shows without one. */
  remote: Accessor<Remote | null>;
  /** resolves the ordered list of items a "stream" click would request -
   *  called lazily (only once the user actually picks "stream"), so a
   *  normal play click never pays for this (e.g. a series' full
   *  resume-aware episode list, which needs its own progress fetch). */
  resolveStreamItems: () => Promise<RequestQueueItem[] | null>;
  /** unused by `handleStream` itself (stream-on-X auto-tunes rather than
   *  showing a labeled toast - see `requestStation.ts`'s
   *  `submitRequestAndTune`), kept on the props shape so every existing
   *  call site doesn't need to drop its own `streamLabel`/label-building
   *  logic for what would otherwise be an unrelated, purely-cosmetic
   *  ripple across several unrelated files. */
  streamLabel: () => string;
  /** true when the video that would actually start playing (the single
   *  video itself, or whichever episode a series/season's "play"/
   *  "continue" click would resolve to) is already available locally
   *  (a genuinely local import, or a remote video already synced down)
   *  - the whole caret hides in this case: there's no file-access
   *  problem to solve, so the plain play button already does the right
   *  thing on its own, no radio station stuff needed. */
  alreadyLocal?: () => boolean;
  /** optional second stream entry for resumable collections (a series/
   *  season with watch progress): requests every item from the very
   *  beginning, no start position. only offered while `canStartOver`
   *  returns true. */
  resolveStartOverItems?: () => Promise<RequestQueueItem[] | null>;
  canStartOver?: () => boolean;
  /** true when the stream entry would pick up from saved watch progress -
   *  picks the "continue stream on X" label over "play on X". defaults to
   *  `canStartOver` (a resumable collection with progress). callers that
   *  can't know synchronously (bare context-menu rows) get "play on X". */
  hasProgress?: () => boolean;
}

export function useStreamFlyoutActions(props: UseStreamFlyoutActionsProps) {
  const streamStation = useStreamStation(() => props.remote());
  const [busy, setBusy] = createSignal(false);

  // caret visibility is gated on streaming being possible AND the video
  // not already being locally available (see `alreadyLocal`'s doc
  // comment above).
  const showCaret = createMemo(() => !props.alreadyLocal?.() && streamStation() !== null);

  const handleStream = async (resolve: () => Promise<RequestQueueItem[] | null>) => {
    const station = streamStation();
    const remote = props.remote();
    if (!station || !remote || busy()) return;
    setBusy(true);
    try {
      const items = await resolve();
      if (!items || items.length === 0) {
        toast.error("could not resolve an item to request");
        return;
      }
      await submitRequestAndTune(station, items, remote);
    } finally {
      setBusy(false);
    }
  };

  const menuActions = createMemo((): MenuAction[] => {
    const station = streamStation();
    if (!station) return [];
    const hasProgress = props.hasProgress?.() ?? props.canStartOver?.() ?? false;
    const actions: MenuAction[] = [
      {
        label: hasProgress ? `continue stream on "${station.name}"` : `play on "${station.name}"`,
        icon: "radioTower",
        onClick: () => void handleStream(() => props.resolveStreamItems()),
        disabled: busy(),
      },
    ];
    const resolveStartOver = props.resolveStartOverItems;
    if (resolveStartOver && props.canStartOver?.()) {
      actions.push({
        label: `stream from the start on "${station.name}"`,
        icon: "radioTower",
        onClick: () => void handleStream(resolveStartOver),
        disabled: busy(),
      });
    }
    return actions;
  });

  return { showCaret, menuActions };
}
