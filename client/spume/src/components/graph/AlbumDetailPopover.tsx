// floating detail card for an album node — shown on hover / select / tap.
// pure presentational; parent positions it absolutely over the canvas.
// supports a list of albums with a prev/next carousel (e.g. lasso picks,
// or "all albums sharing this connection").

import { createMemo, For, Show } from "solid-js";
import type { AlbumNodeData, RelationKindLike } from "./types";
import { AlbumNodeView } from "./AlbumNodeView";
import { Icon, IconNames } from "../icons/registry";
import { MarqueeText } from "../text/MarqueeText";
import { FavoriteHeart } from "../ratings/FavoriteHeart";

// long-press timing — kept in sync with RelationLegend so the gesture
// feels identical across both surfaces.
const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE_PX = 6;

export interface AlbumDetailPopoverProps {
  /** single album shorthand. ignored when `albums` is supplied. */
  album?: AlbumNodeData;
  /** carousel mode — array of albums to page through */
  albums?: AlbumNodeData[];
  /** controlled current index into `albums` (default 0) */
  index?: number;
  onIndexChange?: (next: number) => void;
  /** when supplied, positions the popover absolutely at these css coords */
  x?: number;
  y?: number;
  /** clicking a taxon pill (genre/mood/style/tag) — parent can use this to
   *  trigger the same focus behavior as clicking the matching connection
   *  wire on the canvas. */
  onRelationClick?: (kind: RelationKindLike, label: string) => void;
  /**
   * long-press handler — fires when the user holds down on a pill for
   * `LONG_PRESS_MS` without moving. mirrors the relation panel's "solo"
   * gesture: parent should clear every other active relation and keep
   * only this one.
   */
  onRelationSolo?: (kind: RelationKindLike, label: string) => void;
  /**
   * set of currently "active" relations, encoded as `"kind|label"`. when
   * provided, the matching pills render in a toggled-on state so the user
   * can see which relations they've layered on top of the graph.
   */
  activeRelations?: Set<string>;
  // action handlers — same set as the album detail view
  onPlay?: (album: AlbumNodeData) => void;
  onShuffle?: (album: AlbumNodeData) => void;
  onAddToQueue?: (album: AlbumNodeData) => void;
  onViewAlbum?: (album: AlbumNodeData) => void;
  onViewArtist?: (album: AlbumNodeData) => void;
  onToggleFavorite?: (album: AlbumNodeData) => void;
  /** opens the album editor modal. parent is responsible for gating
   *  on admin permission — if undefined, the edit button is hidden. */
  onEdit?: (album: AlbumNodeData) => void;
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function AlbumDetailPopover(props: AlbumDetailPopoverProps) {
  const positioned = () => props.x !== undefined && props.y !== undefined;

  const list = createMemo<AlbumNodeData[]>(() => {
    if (props.albums && props.albums.length > 0) return props.albums;
    return props.album ? [props.album] : [];
  });
  const idx = createMemo(() => {
    const n = list().length;
    if (n === 0) return 0;
    const raw = props.index ?? 0;
    return ((raw % n) + n) % n;
  });
  const album = createMemo(() => list()[idx()]);
  const hasCarousel = () => list().length > 1;
  const hasAnyAction = () =>
    !!(
      props.onPlay ||
      props.onShuffle ||
      props.onAddToQueue ||
      props.onViewAlbum ||
      props.onViewArtist ||
      props.onToggleFavorite ||
      props.onEdit
    );

  const go = (delta: number) => {
    const n = list().length;
    if (n === 0) return;
    const next = (((idx() + delta) % n) + n) % n;
    props.onIndexChange?.(next);
  };

  return (
    <Show when={album()}>
      <div
        class="rounded-lg bg-[var(--color-bg-elevated)] border border-white/10 shadow-xl text-[var(--color-text)] w-72 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-var(--nav-height,56px)-1.5rem)] overflow-y-auto flex flex-col"
        style={
          positioned()
            ? {
                position: "absolute",
                left: `${props.x}px`,
                top: `${props.y}px`,
                "pointer-events": "auto",
                "z-index": 20,
              }
            : undefined
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div class="flex gap-3 p-3">
          <AlbumNodeView album={album()!} size={72} />
          <div class="flex-1 min-w-0">
            <MarqueeText text={album()!.title} class="font-semibold text-sm leading-tight" />
            <MarqueeText text={album()!.artistName} class="text-xs text-white/80 mt-0.5" />
            <div class="text-[11px] text-white/65 mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
              <Show when={album()!.year}>
                <span>{album()!.year}</span>
              </Show>
              <Show when={album()!.trackCount}>
                <span>· {album()!.trackCount} tracks</span>
              </Show>
              <Show when={album()!.totalDurationSec}>
                <span>· {formatDuration(album()!.totalDurationSec)}</span>
              </Show>
            </div>
            <Show when={album()!.label}>
              <div class="text-[11px] text-white/65 truncate mt-0.5">{album()!.label}</div>
            </Show>
          </div>
        </div>

        <Show when={hasAnyAction()}>
          <div class="px-3 pb-2 flex flex-wrap gap-1">
            <Show when={props.onPlay}>
              <ActionButton
                icon={IconNames.play}
                label="play"
                onClick={() => props.onPlay?.(album()!)}
              />
            </Show>
            <Show when={props.onShuffle}>
              <ActionButton
                icon={IconNames.shuffle}
                label="shuffle"
                onClick={() => props.onShuffle?.(album()!)}
              />
            </Show>
            <Show when={props.onAddToQueue}>
              <ActionButton
                icon={IconNames.queue}
                label="queue"
                onClick={() => props.onAddToQueue?.(album()!)}
              />
            </Show>
            <Show when={props.onToggleFavorite}>
              {/* presentational heart — parent owns the toggle mutation
                  (incl. remote scoping + library-albums invalidation), so
                  we use FavoriteHeart directly rather than the smart
                  FavoriteToggle wrapper. fills when isFavorite is true. */}
              <FavoriteHeart
                isFavorite={album()!.isFavorite ?? false}
                size="sm"
                onToggle={() => props.onToggleFavorite?.(album()!)}
              />
            </Show>
            <Show when={props.onViewAlbum}>
              <ActionButton
                icon={IconNames.album}
                label="open"
                onClick={() => props.onViewAlbum?.(album()!)}
              />
            </Show>
            <Show when={props.onViewArtist}>
              <ActionButton
                icon={IconNames.artist}
                label="artist"
                onClick={() => props.onViewArtist?.(album()!)}
              />
            </Show>
            <Show when={props.onEdit}>
              <ActionButton
                icon={IconNames.edit}
                label="edit"
                onClick={() => props.onEdit?.(album()!)}
              />
            </Show>
          </div>
        </Show>

        <div class="px-3 pb-3 space-y-2">
          <Show when={album()!.genres.length > 0}>
            <PillRow
              label="genres"
              items={album()!.genres}
              kind="genre"
              onPick={props.onRelationClick}
              onSolo={props.onRelationSolo}
              active={props.activeRelations}
            />
          </Show>
          <Show when={album()!.moods.length > 0}>
            <PillRow
              label="moods"
              items={album()!.moods}
              kind="mood"
              onPick={props.onRelationClick}
              onSolo={props.onRelationSolo}
              active={props.activeRelations}
            />
          </Show>
          <Show when={album()!.styles.length > 0}>
            <PillRow
              label="styles"
              items={album()!.styles}
              kind="style"
              onPick={props.onRelationClick}
              onSolo={props.onRelationSolo}
              active={props.activeRelations}
            />
          </Show>
          <Show when={album()!.tags.length > 0}>
            <PillRow
              label="tags"
              items={album()!
                .tags.slice(0, 8)
                .map((t) => t.label)}
              kind="tag"
              onPick={props.onRelationClick}
              onSolo={props.onRelationSolo}
              active={props.activeRelations}
            />
          </Show>
          <Show when={album()!.era}>
            {(() => {
              // era is a one-off button so it gets its own long-press state
              let pressTimer: number | null = null;
              let pressStart: { x: number; y: number } | null = null;
              let pressFired = false;
              const clearPress = () => {
                if (pressTimer !== null) {
                  window.clearTimeout(pressTimer);
                  pressTimer = null;
                }
                pressStart = null;
              };
              return (
                <div class="text-[11px] text-white/70">
                  era:{" "}
                  <button
                    type="button"
                    class="px-1.5 py-0.5 rounded border transition-colors select-none touch-none"
                    classList={{
                      "bg-[var(--color-accent-500,#ff1a9e)]/15 border-[var(--color-accent-500,#ff1a9e)]/60 text-white":
                        props.activeRelations?.has(`era|${album()!.era ?? ""}`) ?? false,
                      "border-white/10 text-white/85 hover:border-[var(--color-accent-500,#ff1a9e)]/60 hover:text-white":
                        !(props.activeRelations?.has(`era|${album()!.era ?? ""}`) ?? false),
                    }}
                    disabled={!props.onRelationClick}
                    title={props.onRelationSolo ? "hold to solo" : undefined}
                    onPointerDown={(e) => {
                      if (!props.onRelationSolo) return;
                      pressFired = false;
                      pressStart = { x: e.clientX, y: e.clientY };
                      if (pressTimer !== null) window.clearTimeout(pressTimer);
                      pressTimer = window.setTimeout(() => {
                        pressFired = true;
                        pressTimer = null;
                        props.onRelationSolo?.("era", album()!.era!);
                      }, LONG_PRESS_MS);
                    }}
                    onPointerMove={(e) => {
                      if (!pressStart) return;
                      if (
                        Math.abs(e.clientX - pressStart.x) > LONG_PRESS_MOVE_TOLERANCE_PX ||
                        Math.abs(e.clientY - pressStart.y) > LONG_PRESS_MOVE_TOLERANCE_PX
                      ) {
                        clearPress();
                      }
                    }}
                    onPointerUp={clearPress}
                    onPointerCancel={clearPress}
                    onPointerLeave={clearPress}
                    onContextMenu={(e) => {
                      if (pressFired) e.preventDefault();
                    }}
                    onClick={(e) => {
                      if (pressFired) {
                        pressFired = false;
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                      }
                      props.onRelationClick?.("era", album()!.era!);
                    }}
                  >
                    {album()!.era}
                  </button>
                </div>
              );
            })()}
          </Show>
        </div>

        <Show when={hasCarousel()}>
          <div class="mt-auto flex items-center justify-between px-3 py-1.5 border-t border-white/10 text-[11px] text-white/75 sticky bottom-0 bg-[var(--color-bg-elevated)] z-10">
            <button
              type="button"
              class="px-2 py-0.5 rounded hover:bg-white/10 disabled:opacity-30"
              onClick={() => go(-1)}
              aria-label="previous album"
            >
              ‹
            </button>
            <span class="tabular-nums">
              {idx() + 1} / {list().length}
            </span>
            <button
              type="button"
              class="px-2 py-0.5 rounded hover:bg-white/10"
              onClick={() => go(1)}
              aria-label="next album"
            >
              ›
            </button>
          </div>
        </Show>
      </div>
    </Show>
  );
}

function ActionButton(props: {
  icon: string;
  label: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      class="flex items-center gap-1 px-2 py-1 rounded border border-white/10 text-[11px] text-white/80 hover:text-white hover:bg-white/5 hover:border-white/20 transition-colors"
      classList={{
        "text-[var(--color-accent-500,#ff1a9e)] border-[var(--color-accent-500,#ff1a9e)]/40":
          props.accent,
      }}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
    >
      <Icon name={props.icon as any} size={12} />
      <span>{props.label}</span>
    </button>
  );
}

function PillRow(props: {
  label: string;
  items: string[];
  kind?: RelationKindLike;
  onPick?: (kind: RelationKindLike, label: string) => void;
  /** long-press "solo" — hold to clear other relations and keep just this one */
  onSolo?: (kind: RelationKindLike, label: string) => void;
  /** set of `"kind|label"` keys that should render in toggled-on state */
  active?: Set<string>;
}) {
  const clickable = () => !!(props.onPick && props.kind);
  const isActive = (item: string) =>
    !!(props.kind && props.active?.has(`${String(props.kind)}|${item}`));
  return (
    <div>
      <div class="text-[10px] uppercase tracking-wide text-white/55 mb-1">{props.label}</div>
      <div class="flex flex-wrap gap-1">
        <For each={props.items}>
          {(item) => {
            // per-button long-press state — same machinery as RelationLegend
            let pressTimer: number | null = null;
            let pressStart: { x: number; y: number } | null = null;
            let pressFired = false;
            const clearPress = () => {
              if (pressTimer !== null) {
                window.clearTimeout(pressTimer);
                pressTimer = null;
              }
              pressStart = null;
            };
            return (
              <button
                type="button"
                class="text-[11px] px-1.5 py-0.5 rounded border transition-colors select-none touch-none"
                classList={{
                  "bg-[var(--color-accent-500,#ff1a9e)]/15 border-[var(--color-accent-500,#ff1a9e)]/60 text-white":
                    isActive(item),
                  "bg-[var(--color-bg)] border-white/10 text-white/85 hover:border-[var(--color-accent-500,#ff1a9e)]/60 hover:text-white cursor-pointer":
                    clickable() && !isActive(item),
                  "bg-[var(--color-bg)] border-white/10 text-white/85 cursor-default": !clickable(),
                }}
                disabled={!clickable()}
                aria-pressed={isActive(item)}
                title={props.onSolo ? "hold to solo" : undefined}
                onPointerDown={(e) => {
                  if (!props.onSolo || !props.kind) return;
                  pressFired = false;
                  pressStart = { x: e.clientX, y: e.clientY };
                  if (pressTimer !== null) window.clearTimeout(pressTimer);
                  pressTimer = window.setTimeout(() => {
                    pressFired = true;
                    pressTimer = null;
                    if (props.kind && props.onSolo) props.onSolo(props.kind, item);
                  }, LONG_PRESS_MS);
                }}
                onPointerMove={(e) => {
                  if (!pressStart) return;
                  if (
                    Math.abs(e.clientX - pressStart.x) > LONG_PRESS_MOVE_TOLERANCE_PX ||
                    Math.abs(e.clientY - pressStart.y) > LONG_PRESS_MOVE_TOLERANCE_PX
                  ) {
                    clearPress();
                  }
                }}
                onPointerUp={clearPress}
                onPointerCancel={clearPress}
                onPointerLeave={clearPress}
                onContextMenu={(e) => {
                  if (pressFired) e.preventDefault();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (pressFired) {
                    // swallow the click that follows a long-press
                    pressFired = false;
                    e.preventDefault();
                    return;
                  }
                  if (props.kind && props.onPick) props.onPick(props.kind, item);
                }}
              >
                {item}
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}
