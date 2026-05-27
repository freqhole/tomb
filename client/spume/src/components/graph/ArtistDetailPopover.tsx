// floating detail card for an artist node — shown on hover / select / tap.
// pure presentational; parent positions it absolutely over the canvas.
// supports a list of artists with a prev/next carousel (selected artist
// first, related artists appended).
//
// status: stub. mirrors AlbumDetailPopover layout-wise (header tile,
// action row, taxonomy pills, carousel footer) but with artist-shaped
// data. interaction surface kept intentionally small until product
// requirements firm up — extend incrementally.

import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { AlbumNodeData, ArtistNodeData, RelationKindLike } from "./types";
import { IconNames } from "../icons/registry";
import { MarqueeText } from "../text/MarqueeText";
import { MediaImage } from "../media/MediaImage";
import { FavoriteHeart } from "../ratings/FavoriteHeart";
import { AlbumNodeView } from "./AlbumNodeView";
import { RemoteSplitButton, type ContributingRemote } from "./RemoteSplitButton";

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
  /** view-artist callback. when `contributingRemotes` is supplied and
   *  has more than one entry, the popover's open button becomes a
   *  split-button — the parent receives the picked `remoteId` so it
   *  can route navigation to that remote. when omitted / single,
   *  `remoteId` is the sole entry's id (or undefined). */
  onViewArtist?: (artist: ArtistNodeData, remoteId?: string) => void;
  /** opens the artist editor modal. parent is responsible for gating
   *  on admin permission — if undefined, the edit button is hidden.
   *  same multi-remote semantics as `onViewArtist`. */
  onEdit?: (artist: ArtistNodeData, remoteId?: string) => void;
  /** every remote that has an equivalent artist (same name slug).
   *  parent owns the sort order — first entry is the default. when
   *  length > 1, the edit + open buttons render as split-buttons with
   *  a dropdown so the user can choose which remote to act against. */
  contributingRemotes?: ContributingRemote[];
  /** notifies parent that the user picked a different artist in the
   *  carousel — e.g. so the canvas selection can follow. */
  onFocusArtist?: (artist: ArtistNodeData) => void;
  /** optional biography string. when present, rendered (clamped) below
   *  the action row. the parent owns hydration — e.g. fetching the
   *  full artist record for the current selection via getArtist. */
  bio?: string | null;
  /** whether the current user has favorited this artist. when defined
   *  alongside onToggleFavorite, a heart toggle is shown in the action
   *  row. defaults to false; undefined hides the control entirely. */
  isFavorite?: boolean;
  /** toggles favorite state for this artist. parent owns the mutation. */
  onToggleFavorite?: (artist: ArtistNodeData, next: boolean) => void;
  /** clicking the avatar tile — parent typically opens an image
   *  carousel modal with the artist's image(s). undefined leaves the
   *  avatar non-interactive (default). */
  onImageClick?: (artist: ArtistNodeData) => void;
  /** in-library albums for the currently-shown artist. parent supplies
   *  this; we render a clickable list under the bio. omit / empty
   *  array hides the section entirely. */
  albums?: AlbumNodeData[];
  /** click handler for an album in the list — parent typically focuses
   *  the matching album node on the graph (which surfaces the album
   *  detail popover). */
  onSelectAlbum?: (album: AlbumNodeData) => void;
  /** related artists for the currently-shown artist (in-library only;
   *  external/ghost rows belong in the enrichment panel). rendered as
   *  a circular-avatar list beneath the album list. omit / empty hides
   *  the section entirely. */
  relatedArtists?: ArtistNodeData[];
  /** optional per-row metadata keyed by `ArtistNodeData.id` — carries
   *  the bidirectional relationship `direction` (`"outgoing"`,
   *  `"incoming"`, `"both"`) and review `status` (`"accepted"` or
   *  `"pending"`). when provided, the popover renders subtle direction
   *  glyphs and a `pending` badge alongside each row. when absent, the
   *  row renders as before. */
  relatedArtistMeta?: Map<
    string,
    {
      direction: "outgoing" | "incoming" | "both";
      status: "accepted" | "pending";
    }
  >;
  /** click handler for a related-artist row — parent typically focuses
   *  the matching artist node on the graph (which keeps this popover
   *  open and swaps it to the picked artist). */
  onSelectRelatedArtist?: (artist: ArtistNodeData) => void;
  /** optional label describing which remote the bio/image data was
   *  fetched from. rendered as a small caption near the action row so
   *  the user can tell when the detail data is coming from a different
   *  remote than they expected (common in multi-remote graphs where
   *  the active data source diverges from the selected node's remote). */
  dataSourceRemoteName?: string | null;
  /** id of the remote shown in `dataSourceRemoteName`. used to dim the
   *  label when it matches the currently-selected artist's remote
   *  (no surprise) and brighten it when it differs. */
  dataSourceRemoteId?: string | null;
  /** when the artist exists on multiple remotes (cross-remote cluster),
   *  this list drives a small picker tucked next to the "data from"
   *  caption so the user can manually choose which remote drives the
   *  popover (bio, image, taxonomy). order matches RemoteSplitButton
   *  conventions (parent sorts; first entry is the default). when
   *  undefined or length <= 1, the picker is not rendered. */
  dataSourceRemotes?: ContributingRemote[];
  /** invoked when the user picks a different remote in the
   *  data-source picker. parent owns the override state and should
   *  re-render with new `dataSourceRemoteName`/`Id`. */
  onPickDataSourceRemote?: (remoteId: string) => void;
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
  const hasFavoriteToggle = () => props.isFavorite !== undefined && !!props.onToggleFavorite;
  const hasAnyAction = () => !!props.onViewArtist || !!props.onEdit || hasFavoriteToggle();
  // bios from upstream sources (musicbrainz, last.fm, discogs) often
  // contain HTML — anchor tags around references, occasional <br>,
  // etc. strip tags and decode the handful of entities we actually
  // see in practice so the popover renders clean text. (no external
  // sanitizer dep — this string is rendered as plain text via
  // {bioText()}, never as innerHTML.)
  const stripBioHtml = (raw: string): string => {
    if (!raw) return "";
    let s = raw;
    // drop <script>/<style> blocks entirely (defensive — we never
    // pass this through innerHTML, but keeps the visible text clean).
    s = s.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
    // turn <br> / <p> / <li> boundaries into newlines before stripping
    // tags so paragraph structure survives the strip.
    s = s.replace(/<\s*br\s*\/?\s*>/gi, "\n");
    s = s.replace(/<\s*\/\s*(p|div|li|h[1-6])\s*>/gi, "\n\n");
    // strip every remaining tag.
    s = s.replace(/<[^>]+>/g, "");
    // decode the entities we actually encounter in bios.
    s = s
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#x?([0-9a-f]+);/gi, (_, code) => {
        const n = code.toLowerCase().startsWith("x")
          ? parseInt(code.slice(1), 16)
          : parseInt(code, 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : "";
      });
    // collapse 3+ blank lines down to a single blank line.
    s = s.replace(/\n{3,}/g, "\n\n");
    return s.trim();
  };
  const bioText = createMemo(() => stripBioHtml(props.bio ?? ""));
  const [bioExpanded, setBioExpanded] = createSignal(false);

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
        class="rounded-lg bg-[var(--color-bg-elevated)] border border-white/10 shadow-xl text-[var(--color-text)] w-72 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-var(--nav-height,56px)-5rem)] overflow-y-auto flex flex-col"
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
          <ArtistAvatar
            artist={artist()!}
            size={72}
            onClick={props.onImageClick ? () => props.onImageClick!(artist()!) : undefined}
          />
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
          <div class="px-3 pb-2 flex flex-wrap items-center gap-1">
            <Show when={hasFavoriteToggle()}>
              <FavoriteHeart
                isFavorite={!!props.isFavorite}
                size="sm"
                onToggle={(next) => props.onToggleFavorite?.(artist()!, next)}
              />
            </Show>
            <Show when={props.onViewArtist}>
              <RemoteSplitButton
                icon={IconNames.artist}
                label="open"
                remotes={props.contributingRemotes}
                onPick={(remoteId) => props.onViewArtist?.(artist()!, remoteId)}
              />
            </Show>
            <Show when={props.onEdit}>
              <RemoteSplitButton
                icon={IconNames.edit}
                label="edit"
                remotes={props.contributingRemotes}
                onPick={(remoteId) => props.onEdit?.(artist()!, remoteId)}
              />
            </Show>
          </div>
        </Show>

        <Show when={props.dataSourceRemoteName}>
          <div class="px-3 pb-2 -mt-1">
            <div
              class="text-[9px] uppercase tracking-wide text-white/45 flex items-center gap-1"
              title="remote that supplied this artist's bio + images"
            >
              <span>data from</span>
              <Show
                when={
                  props.dataSourceRemotes &&
                  props.dataSourceRemotes.length > 1 &&
                  props.onPickDataSourceRemote
                }
                fallback={
                  <span class="text-white/70 normal-case tracking-normal">
                    {props.dataSourceRemoteName}
                  </span>
                }
              >
                <DataSourceRemotePicker
                  current={props.dataSourceRemoteId ?? null}
                  currentName={props.dataSourceRemoteName ?? ""}
                  remotes={props.dataSourceRemotes!}
                  onPick={(id) => props.onPickDataSourceRemote!(id)}
                />
              </Show>
            </div>
          </div>
        </Show>

        <Show when={bioText().length > 0}>
          <div class="px-3 pb-2">
            <div class="text-[10px] uppercase tracking-wide text-white/55 mb-1">bio</div>
            <p
              class="text-[11px] leading-snug text-white/75 whitespace-pre-line"
              classList={{
                "line-clamp-4": !bioExpanded(),
              }}
            >
              {bioText()}
            </p>
            <Show when={bioText().length > 220}>
              <button
                type="button"
                class="mt-1 text-[10px] text-white/55 hover:text-white/85 cursor-pointer underline-offset-2 hover:underline"
                onClick={() => setBioExpanded((v) => !v)}
              >
                {bioExpanded() ? "show less" : "show more"}
              </button>
            </Show>
          </div>
        </Show>

        <Show when={(props.albums ?? []).length > 0}>
          <div class="px-3 pb-2">
            <div class="text-[10px] uppercase tracking-wide text-white/55 mb-1">
              albums ({(props.albums ?? []).length})
            </div>
            <div class="flex flex-col gap-1 max-h-48 overflow-y-auto">
              <For each={props.albums}>
                {(alb) => {
                  const clickable = !!props.onSelectAlbum;
                  return (
                    <button
                      type="button"
                      class="flex items-center gap-2 px-1.5 py-1 rounded border border-transparent text-left transition-colors"
                      classList={{
                        "hover:bg-white/5 hover:border-white/10 cursor-pointer": clickable,
                        "cursor-default": !clickable,
                      }}
                      disabled={!clickable}
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onSelectAlbum?.(alb);
                      }}
                    >
                      <AlbumNodeView album={alb} size={36} />
                      <div class="flex-1 min-w-0">
                        <MarqueeText
                          text={alb.title}
                          class="text-[11px] text-white/90 leading-tight"
                          hoverOnly={true}
                        />
                        <Show when={alb.year}>
                          <div class="text-[10px] text-white/55 truncate leading-tight">
                            {alb.year}
                          </div>
                        </Show>
                      </div>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>
        </Show>

        <Show when={(props.relatedArtists ?? []).length > 0}>
          <div class="px-3 pb-2">
            <div class="text-[10px] uppercase tracking-wide text-white/55 mb-1">
              related artists ({(props.relatedArtists ?? []).length})
            </div>
            <div class="flex flex-col gap-1 max-h-48 overflow-y-auto">
              <For each={props.relatedArtists}>
                {(rel) => {
                  // stubs surfaced by the parent for external (not
                  // in any loaded library) related artists carry an
                  // empty artistId; they're shown dimmed and are not
                  // clickable since there's no node to focus.
                  const inLibrary = !!rel.artistId;
                  const clickable = inLibrary && !!props.onSelectRelatedArtist;
                  const meta = () => props.relatedArtistMeta?.get(rel.id);
                  const isPending = () => meta()?.status === "pending";
                  const directionGlyph = () => {
                    const d = meta()?.direction;
                    if (d === "both") return "\u2194";
                    if (d === "incoming") return "\u2190";
                    return null; // outgoing or no meta — default, no glyph
                  };
                  const directionTitle = () => {
                    const d = meta()?.direction;
                    if (d === "both") return "mutual relation";
                    if (d === "incoming") return "lists this artist as related";
                    return undefined;
                  };
                  return (
                    <button
                      type="button"
                      class="flex items-center gap-2 px-1.5 py-1 rounded border text-left transition-colors"
                      classList={{
                        "hover:bg-white/5 hover:border-white/10 cursor-pointer": clickable,
                        "cursor-default": !clickable,
                        "opacity-60": !inLibrary,
                        "border-transparent": !isPending(),
                        // pending rows: dashed amber border so they
                        // read as "proposed but unconfirmed" without
                        // shouting at the user.
                        "border-dashed border-amber-400/40": isPending(),
                      }}
                      disabled={!clickable}
                      title={inLibrary ? directionTitle() : "not in any loaded library"}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (clickable) props.onSelectRelatedArtist?.(rel);
                      }}
                    >
                      <ArtistAvatar artist={rel} size={36} />
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-1.5">
                          <MarqueeText
                            text={rel.name}
                            class="text-[11px] text-white/90 leading-tight flex-1 min-w-0"
                            hoverOnly={true}
                          />
                          <Show when={directionGlyph()}>
                            <span
                              class="shrink-0 text-[10px] text-white/55 leading-none"
                              title={directionTitle()}
                            >
                              {directionGlyph()}
                            </span>
                          </Show>
                          <Show when={isPending()}>
                            <span
                              class="shrink-0 text-[9px] uppercase tracking-wide text-amber-300/80 leading-none"
                              title="proposed; not yet accepted"
                            >
                              pending
                            </span>
                          </Show>
                          <Show when={inLibrary}>
                            <span
                              class="shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--color-accent-500,#ff1a9e)]"
                              aria-label="in library"
                              title="in library"
                            />
                          </Show>
                        </div>
                        <Show
                          when={inLibrary && rel.albumCount > 0}
                          fallback={
                            <Show when={!inLibrary}>
                              <div class="text-[10px] text-white/45 truncate leading-tight">
                                external
                              </div>
                            </Show>
                          }
                        >
                          <div class="text-[10px] text-white/55 truncate leading-tight">
                            {rel.albumCount} {rel.albumCount === 1 ? "album" : "albums"}
                          </div>
                        </Show>
                      </div>
                    </button>
                  );
                }}
              </For>
            </div>
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

// small inline picker rendered next to the "data from" caption when the
// selected artist exists on more than one remote. lets the user choose
// which contributing remote drives the popover content (bio, image,
// taxonomy). same dropdown shape as RemoteSplitButton's chevron menu,
// just collapsed into a single text-styled trigger so it sits in-line
// with the caption.
function DataSourceRemotePicker(props: {
  current: string | null;
  currentName: string;
  remotes: ContributingRemote[];
  onPick: (remoteId: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  let containerRef: HTMLSpanElement | undefined;
  let menuRef: HTMLDivElement | undefined;
  const [shift, setShift] = createSignal<{ x: number; flip: boolean }>({ x: 0, flip: false });

  const recomputeShift = () => {
    if (!menuRef) return;
    menuRef.style.transform = "";
    const rect = menuRef.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 6;
    let x = 0;
    if (rect.right > vw - pad) x -= rect.right - (vw - pad);
    if (rect.left + x < pad) x += pad - (rect.left + x);
    const flip =
      rect.bottom > vh - pad && containerRef
        ? containerRef.getBoundingClientRect().top > rect.height + pad
        : false;
    setShift({ x, flip });
  };

  // close on outside click + reposition on resize/scroll while open.
  let docHandler: ((e: MouseEvent) => void) | null = null;
  let winHandler: (() => void) | null = null;
  const attach = () => {
    docHandler = (e) => {
      if (!containerRef) return;
      if (!containerRef.contains(e.target as Node)) setOpen(false);
    };
    winHandler = () => recomputeShift();
    document.addEventListener("mousedown", docHandler);
    window.addEventListener("resize", winHandler);
    window.addEventListener("scroll", winHandler, true);
  };
  const detach = () => {
    if (docHandler) document.removeEventListener("mousedown", docHandler);
    if (winHandler) {
      window.removeEventListener("resize", winHandler);
      window.removeEventListener("scroll", winHandler, true);
    }
    docHandler = null;
    winHandler = null;
  };
  onCleanup(detach);

  return (
    <span ref={containerRef} class="relative inline-flex items-center">
      <button
        type="button"
        title="switch data source remote"
        aria-haspopup="menu"
        aria-expanded={open()}
        class="inline-flex items-center gap-0.5 text-white/70 normal-case tracking-normal hover:text-white cursor-pointer underline-offset-2 hover:underline"
        onClick={(e) => {
          e.stopPropagation();
          const next = !open();
          setOpen(next);
          if (next) {
            attach();
            queueMicrotask(recomputeShift);
          } else {
            detach();
          }
        }}
      >
        <span>{props.currentName}</span>
        <span class="text-[9px] text-white/45">▾</span>
      </button>
      <Show when={open()}>
        <div
          ref={menuRef}
          role="menu"
          class="absolute z-30 left-0 min-w-[10rem] max-w-[min(18rem,calc(100vw-1rem))] rounded border border-white/15 bg-[var(--color-bg-elevated)] shadow-lg py-1 max-h-[min(16rem,calc(100vh-2rem))] overflow-y-auto"
          classList={{
            "top-full mt-1": !shift().flip,
            "bottom-full mb-1": shift().flip,
          }}
          style={shift().x !== 0 ? { transform: `translateX(${shift().x}px)` } : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          <For each={props.remotes}>
            {(r) => (
              <button
                type="button"
                role="menuitem"
                class="w-full text-left flex items-center gap-2 px-2 py-1 text-[11px] text-white/85 hover:bg-white/10 cursor-pointer"
                classList={{ "bg-white/5": r.id === props.current }}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  detach();
                  props.onPick(r.id);
                }}
              >
                <span class="flex-1 truncate normal-case tracking-normal">{r.name}</span>
                <Show when={r.id === props.current}>
                  <span class="text-[9px] text-emerald-300/80">●</span>
                </Show>
                <Show when={r.isCharnelManaged}>
                  <span class="text-[9px] uppercase tracking-wide text-emerald-300/60">local</span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </span>
  );
}

function ArtistAvatar(props: { artist: ArtistNodeData; size: number; onClick?: () => void }) {
  // prefer the structured ImageMetadata path — MediaImage handles
  // local blobs, p2p, and charnel-managed remotes via its transport-
  // aware resolver. fall back to a raw <img> for legacy pre-resolved
  // urls (storybook mocks etc), and to the abbreviation tile when no
  // image data is available at all.
  const hasImage = () => !!props.artist.image || !!props.artist.imageUrl;
  const interactive = () => !!props.onClick && hasImage();
  return (
    <div
      class="rounded-full overflow-hidden border border-white/10 bg-white/5 flex items-center justify-center text-white/85 font-semibold shrink-0"
      classList={{
        "cursor-pointer hover:border-[var(--color-accent-500,#ff1a9e)]/60 transition-colors":
          interactive(),
      }}
      style={{
        width: `${props.size}px`,
        height: `${props.size}px`,
        "font-size": `${Math.max(11, Math.floor(props.size * 0.32))}px`,
      }}
      onClick={(e) => {
        if (!interactive()) return;
        e.stopPropagation();
        props.onClick!();
      }}
      role={interactive() ? "button" : undefined}
      tabIndex={interactive() ? 0 : undefined}
      onKeyDown={(e) => {
        if (!interactive()) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onClick!();
        }
      }}
      title={interactive() ? "view image" : undefined}
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
