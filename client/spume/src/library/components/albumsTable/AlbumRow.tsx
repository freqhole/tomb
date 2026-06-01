import { For, Show } from "solid-js";
import { ContextMenu as KobalteContextMenu } from "@kobalte/core/context-menu";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import { Icon } from "../../../components/icons/registry";
import MediaImage from "../../../components/media/MediaImage";
import type { MenuAction } from "../../../components/overlays/ContextMenu";
import { MarqueeText } from "../../../components/text/MarqueeText";
import {
  mbLookupStatusLabel,
  mbSearchStageLabel,
  parseAlbumMetadata,
  parseMbLookupStatus,
  topFolksonomyTags,
} from "../../data/albumMetadata";
import { groupBadgeClass, isInFlight, needsReview, statusGroupOf } from "../../data/mbStatusGroups";
import {
  handleAlbumClick,
  isAlbumSelected,
  toggleAlbumSelection,
} from "../../hooks/albumSelection";
import {
  useInflightJobs,
  getInflightSourcesForAlbum,
  getInflightJobForAlbum,
  getJobProgressMessage,
  useJobProgressMessages,
} from "../../hooks/useMbLookupJobs";
import { showBulkReview } from "../../review/bulkReviewModal";
import { useAlbumContextMenu } from "../../../music/hooks/contextMenu";
import type { AlbumSummary } from "../../../music/data/types";
import { SourceDot, type SourceBadgeState } from "./SourceDot";

export function AlbumRow(props: {
  album: AlbumSummary;
  remote: Remote;
  index: number;
  /** invoked from the row context menu to enqueue mb+last.fm+audiodb
   *  enrichment for just this album. omitted when admin gating disables
   *  enrichment in the parent table. */
  onEnrich?: (albumId: string) => void;
}) {
  const status = () => parseMbLookupStatus(props.album.mb_lookup_status);
  const lastLookup = () => {
    const ts = props.album.mb_lookup_at;
    if (!ts) return null;
    const d = new Date(ts * 1000);
    return d.toISOString().slice(0, 10);
  };
  const genreList = () => (props.album.genres ?? []).map((g) => g.name).join(", ");
  const albumMeta = () => parseAlbumMetadata(props.album.metadata);
  const folksonomy = () => topFolksonomyTags(albumMeta(), 5);
  const lastQueryStage = () => albumMeta().musicbrainz?.last_query?.stage ?? null;
  const selected = () => isAlbumSelected(props.album.album_id);
  const inflight = useInflightJobs();
  const inflightSources = () => {
    inflight(); // subscribe
    return getInflightSourcesForAlbum(props.album.album_id);
  };
  // live mb-search stage caption. depends on both signals so the
  // caption reactively appears/disappears as the job progresses.
  const stages = useJobProgressMessages();
  const mbStageMessage = (): string | null => {
    inflight();
    stages();
    const entry = getInflightJobForAlbum(props.album.album_id, "mb");
    if (!entry) return null;
    return getJobProgressMessage(entry.jobId);
  };
  const lastfmState = (): SourceBadgeState => {
    if (inflightSources().has("lastfm")) return "inflight";
    const lf = albumMeta().lastfm;
    if (!lf) return "missing";
    if (lf.error) return "error";
    if (lf.fetched_at) return "ok";
    return "missing";
  };
  const audiodbState = (): SourceBadgeState => {
    if (inflightSources().has("audiodb")) return "inflight";
    const ad = albumMeta().audiodb;
    if (!ad) return "missing";
    if (ad.error) return "error";
    if (ad.fetched_at) return "ok";
    return "missing";
  };
  const reviewable = () => needsReview(status());
  const openReview = () => {
    showBulkReview({
      ids: [props.album.album_id],
      currentIndex: 0,
      remote: props.remote,
      onNext: () => {
        /* single-album review — no-op */
      },
      onPrev: () => {
        /* single-album review — no-op */
      },
      onExit: () => {
        /* dismiss only — no global session to tear down */
      },
    });
  };

  // context menu actions: library-specific prefix (review + enrichment)
  // first, then the shared album menu (play / shuffle / queue / view /
  // favorite / playlist / station / share / tags / edit info), with
  // library-only tail (select toggle, copy id) injected via the hook's
  // customActions slot. recomputed on each open because reactive state
  // (selection, review status, in-flight jobs) changes between opens.
  const menuActions = (): MenuAction[] => {
    const base = useAlbumContextMenu(
      {
        id: props.album.album_id,
        title: props.album.title,
        artist_name: props.album.artist_name,
        artist_id: props.album.artist_id,
        song_count: props.album.song_count,
      },
      {
        showPlayActions: true,
        isFavorite: props.album.is_favorite ?? false,
        remote: props.remote,
        customActions: [
          {
            label: selected() ? "deselect album" : "select album",
            icon: selected() ? "close" : "check",
            onClick: () => toggleAlbumSelection(props.album.album_id, props.index),
          },
        ],
      }
    );

    const prefix: MenuAction[] = [];
    if (reviewable()) {
      prefix.push({
        label: "review candidates",
        icon: "search",
        onClick: () => openReview(),
      });
    }
    if (props.onEnrich) {
      prefix.push({
        label: "look up enrichment",
        icon: "database",
        disabled: inflightSources().size > 0,
        onClick: () => props.onEnrich?.(props.album.album_id),
      });
    }
    if (prefix.length > 0) {
      prefix.push({ type: "separator" });
    }
    return [...prefix, ...base];
  };

  return (
    <>
      <KobalteContextMenu>
        {/* trigger IS the tr — kobalte forwards a11y attrs onto our
         *  element, layout + selection click handler stay intact. */}
        <KobalteContextMenu.Trigger
          as="tr"
          class="border-b border-[var(--color-border-subtle)] cursor-pointer outline-none"
          classList={{
            "bg-[var(--color-accent-500)]/10": selected(),
            "hover:bg-[var(--color-bg-hover)]": !selected(),
          }}
          onClick={(e) => handleAlbumClick(props.album.album_id, props.index, e)}
          data-album-id={props.album.album_id}
          data-remote-id={props.remote.remote_id}
        >
          <td class="px-2 py-1">
            <div class="w-8 h-8 rounded overflow-hidden bg-[var(--color-bg-elevated)]">
              <MediaImage
                images={props.album.images}
                alt={props.album.title}
                size="xs"
                domainType="album"
              />
            </div>
          </td>
          <td class="px-2 py-1 text-[var(--color-text-primary)] max-w-[260px]">
            <MarqueeText text={props.album.title} />
          </td>
          <td class="px-2 py-1 text-[var(--color-text-secondary)] max-w-[200px]">
            <MarqueeText text={props.album.artist_name} />
          </td>
          <td class="px-2 py-1 text-[var(--color-text-muted)]">
            <MarqueeText text={props.album.release_date ?? ""} />
          </td>
          <td class="px-2 py-1 text-[var(--color-text-muted)] text-right">
            {props.album.song_count}
          </td>
          <td class="px-2 py-1 text-[var(--color-text-muted)] max-w-[200px]">
            <MarqueeText text={genreList()} />
          </td>
          <td class="px-2 py-1 max-w-[220px]">
            <Show
              when={folksonomy().length > 0}
              fallback={<span class="text-[var(--color-text-disabled)]">—</span>}
            >
              <MarqueeText
                text={folksonomy()
                  .map((t) => t.name)
                  .join(" · ")}
                title={folksonomy()
                  .map((t) => `${t.name} (${t.count})`)
                  .join(", ")}
                class="text-[10px] text-[var(--color-text-secondary)]"
              />
            </Show>
          </td>
          <td class="px-2 py-1">
            {/* enrichment column: mb status on row 1, source-availability dots on row 2.
             *  the stacked layout keeps the mb chip visually primary and distinguishes it
             *  from the source dots (which are a different state machine). */}
            <div class="flex flex-col gap-0.5">
              {/* row 1: musicbrainz status chip */}
              <div class="flex flex-wrap items-center gap-1">
                {/* musicbrainz status — primary, uses the rich mb_lookup_status enum */}
                <Show
                  when={inflightSources().has("mb") || isInFlight(status())}
                  fallback={
                    <span
                      class={`inline-block px-1.5 py-0.5 rounded text-[10px] ${groupBadgeClass(statusGroupOf(status()))}`}
                      title={(() => {
                        const base = `musicbrainz: ${mbLookupStatusLabel(status())}`;
                        const stage = lastQueryStage();
                        if (stage && needsReview(status())) {
                          return `${base} · ${mbSearchStageLabel(stage)}`;
                        }
                        return base;
                      })()}
                    >
                      mb: {mbLookupStatusLabel(status())}
                    </span>
                  }
                >
                  <span
                    class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-500/15 text-blue-400"
                    title={
                      status() === "auto_applying"
                        ? "auto-applying enrichment from musicbrainz, last.fm, theaudiodb"
                        : "musicbrainz lookup in flight"
                    }
                  >
                    <span class="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                    {status() === "auto_applying" ? "auto-applying…" : "mb"}
                  </span>
                  {/* live broker-stage caption (snake_case stage name or
                   *  human message). only renders while the mb job is
                   *  actually in flight and has emitted a stage event. */}
                  <Show when={mbStageMessage()}>
                    <span
                      class="text-[9px] text-blue-300/70 italic truncate max-w-[14rem]"
                      title={mbStageMessage() ?? ""}
                    >
                      {mbStageMessage()}
                    </span>
                  </Show>
                </Show>
                {/* diversity-gate sub-badge: shown when needs_review was triggered by
                 *  an album-only cascade stage (many distinct artists, title-only match). */}
                <Show when={status() === "needs_review" && lastQueryStage() === "album_only"}>
                  <span
                    class="inline-block px-1 py-0.5 rounded text-[9px] bg-amber-500/10 text-amber-400/70"
                    title="diversity gate: title-only fallback matched multiple distinct artists — manual review required"
                  >
                    title-only
                  </span>
                </Show>
              </div>
              {/* row 2: source-availability dots (last.fm, theaudiodb).
               *  deliberately non-pill so they can't be confused with the mb chip. */}
              <div class="flex items-center gap-2">
                <SourceDot label="last.fm" state={lastfmState()} />
                <SourceDot label="theaudiodb" state={audiodbState()} />
              </div>
            </div>
          </td>
          <td class="px-2 py-1 text-[var(--color-text-muted)]">
            <MarqueeText text={lastLookup() ?? "—"} />
          </td>
          <td class="px-2 py-1 text-[10px]">
            <div class="flex flex-col gap-1">
              <Show
                when={reviewable()}
                fallback={<span class="text-[var(--color-text-disabled)]">—</span>}
              >
                <button
                  type="button"
                  class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-secondary)] cursor-pointer bg-transparent"
                  onClick={(e) => {
                    e.stopPropagation();
                    openReview();
                  }}
                  title="open in review modal"
                >
                  <Icon name="search" size={8} />
                  review
                </button>
              </Show>
              <a
                href={`#/${props.remote.remote_id}/albums/${encodeURIComponent(props.album.album_id)}`}
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-secondary)] cursor-pointer bg-transparent no-underline"
                onClick={(e) => {
                  // stop the row's selection click handler from also firing
                  e.stopPropagation();
                }}
                title="open album page"
              >
                album
              </a>
            </div>
          </td>
        </KobalteContextMenu.Trigger>
        <KobalteContextMenu.Portal>
          <KobalteContextMenu.Content class="min-w-48 bg-[var(--color-bg-elevated)] border border-[var(--color-border-default)] rounded-lg shadow-2xl overflow-hidden z-[1200] origin-top-left">
            <div class="py-1">
              <For each={menuActions()}>
                {(action) => {
                  if (action.type === "separator") {
                    return (
                      <KobalteContextMenu.Separator class="my-1 h-px bg-[var(--color-border-subtle)]" />
                    );
                  }
                  return (
                    <KobalteContextMenu.Item
                      class={`w-full px-4 py-2 text-left flex items-center gap-3 transition-colors body-small outline-none cursor-pointer ${
                        action.disabled
                          ? "text-[var(--color-text-disabled)] cursor-not-allowed opacity-50"
                          : "text-[var(--color-text-primary)] data-[highlighted]:bg-[var(--color-bg-hover)]"
                      }`}
                      onSelect={() => !action.disabled && action.onClick()}
                      disabled={action.disabled}
                      closeOnSelect={true}
                    >
                      <Show when={action.icon}>
                        <Icon name={action.icon!} size={16} color="currentColor" />
                      </Show>
                      <span>{action.label}</span>
                    </KobalteContextMenu.Item>
                  );
                }}
              </For>
            </div>
          </KobalteContextMenu.Content>
        </KobalteContextMenu.Portal>
      </KobalteContextMenu>
    </>
  );
}
