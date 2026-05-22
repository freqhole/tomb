// floating detail card for an artist node — shown on hover / select / tap.
// pure presentational; parent positions it absolutely over the canvas.
// supports a list of artists with a prev/next carousel (selected artist
// first, related artists appended).
//
// status: stub. mirrors AlbumDetailPopover layout-wise (header tile,
// action row, taxonomy pills, carousel footer) but with artist-shaped
// data. interaction surface kept intentionally small until product
// requirements firm up — extend incrementally.

import { createMemo, For, Show } from "solid-js";
import type { ArtistNodeData, RelationKindLike } from "./types";
import { Icon, IconNames } from "../icons/registry";
import { MarqueeText } from "../text/MarqueeText";
import { MediaImage } from "../media/MediaImage";

export interface ArtistDetailPopoverProps {
  /** single artist shorthand. ignored when `artists` is supplied. */
  artist?: ArtistNodeData;
  /** carousel mode — array of artists to page through. canonical
   *  layout is [selectedArtist, ...relatedArtists]. */
  artists?: ArtistNodeData[];
  /** controlled current index into `artists` (default 0). */
  index?: number;
  onIndexChange?: (next: number) => void;
  /** absolute css coords for parent-driven positioning. */
  x?: number;
  y?: number;
  /** clicking a taxon pill — same semantics as the album popover. */
  onRelationClick?: (kind: RelationKindLike, label: string) => void;
  /** set of `"kind|label"` keys that should render in toggled-on state. */
  activeRelations?: Set<string>;
  // action handlers
  onViewArtist?: (artist: ArtistNodeData) => void;
  /** opens the artist editor modal. parent is responsible for gating
   *  on admin permission — if undefined, the edit button is hidden. */
  onEdit?: (artist: ArtistNodeData) => void;
  /** notifies parent that the user picked a different artist in the
   *  carousel — e.g. so the canvas selection can follow. */
  onFocusArtist?: (artist: ArtistNodeData) => void;
}

export function ArtistDetailPopover(props: ArtistDetailPopoverProps) {
  const positioned = () => props.x !== undefined && props.y !== undefined;

  const list = createMemo<ArtistNodeData[]>(() => {
    if (props.artists && props.artists.length > 0) return props.artists;
    return props.artist ? [props.artist] : [];
  });
  const idx = createMemo(() => {
    const n = list().length;
    if (n === 0) return 0;
    const raw = props.index ?? 0;
    return ((raw % n) + n) % n;
  });
  const artist = createMemo(() => list()[idx()]);
  const hasCarousel = () => list().length > 1;
  const hasAnyAction = () => !!props.onViewArtist || !!props.onEdit;

  const go = (delta: number) => {
    const n = list().length;
    if (n === 0) return;
    const next = (((idx() + delta) % n) + n) % n;
    props.onIndexChange?.(next);
    const focused = list()[next];
    if (focused) props.onFocusArtist?.(focused);
  };

  return (
    <Show when={artist()}>
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
          <ArtistAvatar artist={artist()!} size={72} />
          <div class="flex-1 min-w-0">
            <MarqueeText text={artist()!.name} class="font-semibold text-sm leading-tight" />
            <div class="text-[11px] text-white/65 mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
              <Show when={artist()!.albumCount > 0}>
                <span>
                  {artist()!.albumCount} album{artist()!.albumCount === 1 ? "" : "s"}
                </span>
              </Show>
              <Show when={artist()!.era}>
                <span>· {artist()!.era}</span>
              </Show>
            </div>
            <Show when={artist()!.label}>
              <div class="text-[11px] text-white/65 truncate mt-0.5">{artist()!.label}</div>
            </Show>
          </div>
        </div>

        <Show when={hasAnyAction()}>
          <div class="px-3 pb-2 flex flex-wrap gap-1">
            <Show when={props.onViewArtist}>
              <ActionButton
                icon={IconNames.artist}
                label="open"
                onClick={() => props.onViewArtist?.(artist()!)}
              />
            </Show>
            <Show when={props.onEdit}>
              <ActionButton
                icon={IconNames.edit}
                label="edit"
                onClick={() => props.onEdit?.(artist()!)}
              />
            </Show>
          </div>
        </Show>

        <div class="px-3 pb-3 space-y-2">
          <Show when={artist()!.genres.length > 0}>
            <PillRow
              label="genres"
              items={artist()!.genres}
              kind="genre"
              onPick={props.onRelationClick}
              active={props.activeRelations}
            />
          </Show>
          <Show when={artist()!.moods.length > 0}>
            <PillRow
              label="moods"
              items={artist()!.moods}
              kind="mood"
              onPick={props.onRelationClick}
              active={props.activeRelations}
            />
          </Show>
          <Show when={artist()!.styles.length > 0}>
            <PillRow
              label="styles"
              items={artist()!.styles}
              kind="style"
              onPick={props.onRelationClick}
              active={props.activeRelations}
            />
          </Show>
          <Show when={artist()!.tags.length > 0}>
            <PillRow
              label="tags"
              items={artist()!
                .tags.slice(0, 8)
                .map((t) => t.label)}
              kind="tag"
              onPick={props.onRelationClick}
              active={props.activeRelations}
            />
          </Show>
        </div>

        <Show when={hasCarousel()}>
          <div class="mt-auto flex items-center justify-between px-3 py-1.5 border-t border-white/10 text-[11px] text-white/75 sticky bottom-0 bg-[var(--color-bg-elevated)] z-10">
            <button
              type="button"
              class="px-2 py-0.5 rounded hover:bg-white/10 cursor-pointer"
              onClick={() => go(-1)}
              aria-label="previous artist"
            >
              ‹
            </button>
            <span class="tabular-nums">
              {idx() + 1} / {list().length}
              <Show when={idx() > 0}>
                <span class="text-white/45"> · related</span>
              </Show>
            </span>
            <button
              type="button"
              class="px-2 py-0.5 rounded hover:bg-white/10 cursor-pointer"
              onClick={() => go(1)}
              aria-label="next artist"
            >
              ›
            </button>
          </div>
        </Show>
      </div>
    </Show>
  );
}

function ArtistAvatar(props: { artist: ArtistNodeData; size: number }) {
  // prefer the structured ImageMetadata path — MediaImage handles
  // local blobs, p2p, and charnel-managed remotes via its transport-
  // aware resolver. fall back to a raw <img> for legacy pre-resolved
  // urls (storybook mocks etc), and to the abbreviation tile when no
  // image data is available at all.
  const hasImage = () => !!props.artist.image || !!props.artist.imageUrl;
  return (
    <div
      class="rounded-full overflow-hidden border border-white/10 bg-white/5 flex items-center justify-center text-white/85 font-semibold shrink-0"
      style={{
        width: `${props.size}px`,
        height: `${props.size}px`,
        "font-size": `${Math.max(11, Math.floor(props.size * 0.32))}px`,
      }}
    >
      <Show when={hasImage()} fallback={<span>{props.artist.abbreviation || "?"}</span>}>
        <Show
          when={props.artist.image}
          fallback={
            <img
              src={props.artist.imageUrl ?? ""}
              alt={props.artist.name}
              class="w-full h-full object-cover"
              loading="lazy"
              draggable={false}
            />
          }
        >
          <MediaImage
            images={[props.artist.image!]}
            alt={props.artist.name}
            thumbnailSize={200}
            domainType="artist"
            showFallback={false}
            class="w-full h-full object-cover"
          />
        </Show>
      </Show>
    </div>
  );
}

function ActionButton(props: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      class="flex items-center gap-1 px-2 py-1 rounded border border-white/10 text-[11px] text-white/80 hover:text-white hover:bg-white/5 hover:border-white/20 transition-colors cursor-pointer"
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
          {(item) => (
            <button
              type="button"
              class="text-[11px] px-1.5 py-0.5 rounded border transition-colors select-none"
              classList={{
                "bg-[var(--color-accent-500,#ff1a9e)]/15 border-[var(--color-accent-500,#ff1a9e)]/60 text-white":
                  isActive(item),
                "bg-[var(--color-bg)] border-white/10 text-white/85 hover:border-[var(--color-accent-500,#ff1a9e)]/60 hover:text-white cursor-pointer":
                  clickable() && !isActive(item),
                "bg-[var(--color-bg)] border-white/10 text-white/85 cursor-default": !clickable(),
              }}
              disabled={!clickable()}
              aria-pressed={isActive(item)}
              onClick={() => {
                if (clickable() && props.kind) props.onPick?.(props.kind, item);
              }}
            >
              {item}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
