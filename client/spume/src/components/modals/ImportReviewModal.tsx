// modal shell for the two-stage import metadata review flow.
// stage 1: album grouping (ImportGroupingView)
// stage 2: per-album metadata (placeholder for BulkEnrichmentReviewModal integration)
//
// all data fetching is the caller's responsibility - this component is presentational.
import { For, Show, createSignal, createMemo, createEffect, on, type JSX } from "solid-js";
import { Modal } from "./Modal";
import { Button } from "../buttons/Button";
import { MediaImage } from "../media/MediaImage";
import { Icon } from "../icons/registry";
import { ImportGroupingView, type ImportReviewAlbum } from "../import/ImportGroupingView";
import type { SendReviewProgress } from "../../app/services/send/sendReviewedSessionToRemote";

// -------------------------------------------------------------------------
// types
// -------------------------------------------------------------------------

export type ImportReviewStage = "grouping" | "metadata";

export interface ImportReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  albums: ImportReviewAlbum[];
  /** true while albums are being fetched - shows a spinner instead of empty state */
  loading?: boolean;
  onComplete: () => void;
  onMergeAlbums: (sourceIds: string[], targetId: string) => void;
  onMoveSong: (songId: string, toAlbumId: string) => void;
  onCreateAlbumForSong: (songId: string, title: string, artistName: string | null) => void;
  onMarkReviewed: (albumId: string) => void;
  /** when set, this session's reviewed albums will be sent to this remote
   *  once review completes - relabels the finalize button accordingly. */
  sendTargetName?: string;
  /** non-null while the post-review send to `sendTargetName` is in flight -
   *  rendered as an inline panel instead of the normal grouping/metadata
   *  content (no toasts for this flow). */
  sendProgress?: SendReviewProgress | null;
  /** render prop for the per-album editor - caller provides the actual editor */
  renderAlbumEditor?: (editorProps: AlbumEditorRenderProps) => JSX.Element;
}

export interface AlbumEditorRenderProps {
  album: ImportReviewAlbum;
  albumIndex: number;
  albumTotal: number;
  isReviewed: boolean;
  onPrev: () => void;
  onNext: () => void;
  onLooksGood: () => void;
}

// -------------------------------------------------------------------------
// step indicator - shown at top of modal in both stages
// -------------------------------------------------------------------------

const STEPS: { id: ImportReviewStage; label: string }[] = [
  { id: "grouping", label: "1. check albums" },
  { id: "metadata", label: "2. fix metadata" },
];

function StepIndicator(props: { current: ImportReviewStage }) {
  return (
    <div class="flex items-center gap-0 mb-5">
      <For each={STEPS}>
        {(step, i) => {
          const isDone = () => STEPS.findIndex((s) => s.id === props.current) > i();
          const isActive = () => props.current === step.id;

          return (
            <>
              <div class="flex flex-col items-center gap-1">
                <div
                  class={`w-6 h-6 rounded-full flex items-center justify-center body-xs font-medium transition-colors ${
                    isDone()
                      ? "bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)]"
                      : isActive()
                        ? "bg-[var(--color-bg-tertiary)] border-2 border-[var(--color-text-secondary)] text-[var(--color-text-primary)]"
                        : "bg-[var(--color-bg-tertiary)] border border-[var(--color-border-default)] text-[var(--color-text-muted)]"
                  }`}
                >
                  {isDone() ? (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 6l3 3 5-5"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  ) : (
                    String(i() + 1)
                  )}
                </div>
                <span
                  class={`body-xs whitespace-nowrap transition-colors ${
                    isActive()
                      ? "text-[var(--color-text-primary)] font-medium"
                      : isDone()
                        ? "text-[var(--color-text-secondary)]"
                        : "text-[var(--color-text-muted)]"
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {/* connector line between steps */}
              <Show when={i() < STEPS.length - 1}>
                <div
                  class={`flex-1 h-px mx-3 mb-4 transition-colors ${
                    isDone() ? "bg-[var(--color-accent-500)]" : "bg-[var(--color-border-default)]"
                  }`}
                />
              </Show>
            </>
          );
        }}
      </For>
    </div>
  );
}

// -------------------------------------------------------------------------
// metadata stage stub (shown when no renderAlbumEditor is provided)
// -------------------------------------------------------------------------

function DefaultAlbumEditorStub(props: AlbumEditorRenderProps) {
  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-3 p-4 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)]">
        <MediaImage
          remoteBlobId={props.album.artworkBlobId}
          remoteServerId={props.album.remoteServerId}
          imageUrl={props.album.artworkUrl}
          alt=""
          size="sm"
          thumbnailSize={200}
          class="w-14 h-14 rounded object-cover flex-shrink-0"
          showFallback
          domainType="album"
        />
        <div>
          <p class="body-base font-medium text-[var(--color-text-primary)]">{props.album.title}</p>
          <p class="body-small text-[var(--color-text-secondary)]">
            {props.album.artist ?? "unknown artist"} &middot; {props.album.songs.length} tracks
          </p>
          <Show when={props.isReviewed}>
            <p class="body-xs text-[var(--color-success-fg,#22c55e)] mt-0.5">reviewed</p>
          </Show>
        </div>
      </div>
      <div class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-secondary)] p-4 text-center">
        <p class="body-small text-[var(--color-text-muted)]">
          album editor (title, artist, artwork, track list) will render here
        </p>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------
// album dot pagination (metadata stage)
// -------------------------------------------------------------------------

function AlbumDots(props: {
  albums: ImportReviewAlbum[];
  currentIndex: number;
  reviewedIds: Set<string>;
  onSelect: (i: number) => void;
}) {
  return (
    <div class="flex items-center gap-1.5 justify-center flex-wrap">
      <For each={props.albums}>
        {(album, i) => {
          const isActive = () => i() === props.currentIndex;
          const isReviewed = () => props.reviewedIds.has(album.id);
          return (
            <button
              class={`w-2.5 h-2.5 rounded-full transition-all ${
                isActive()
                  ? "bg-[var(--color-text-primary)] scale-125"
                  : isReviewed()
                    ? "bg-[var(--color-accent-500)] opacity-70"
                    : "bg-[var(--color-border-default)] hover:bg-[var(--color-text-muted)]"
              }`}
              title={album.title}
              aria-label={`album ${i() + 1}: ${album.title}`}
              aria-current={isActive() ? "true" : undefined}
              onClick={() => props.onSelect(i())}
            />
          );
        }}
      </For>
    </div>
  );
}

// -------------------------------------------------------------------------
// metadata stage footer - nav + per-album actions + finish (primary only here)
// -------------------------------------------------------------------------

function MetadataFooter(props: {
  albums: ImportReviewAlbum[];
  albumIndex: number;
  reviewedIds: Set<string>;
  onSelect: (i: number) => void;
  onLooksGood: () => void;
  sendTargetName?: string;
}) {
  const hasNext = () => props.albumIndex < props.albums.length - 1;

  return (
    <div class="flex flex-col gap-3 pt-3 border-t border-[var(--color-border-subtle)]">
      {/* dot pagination - multiple albums only */}
      <Show when={props.albums.length > 1}>
        <AlbumDots
          albums={props.albums}
          currentIndex={props.albumIndex}
          reviewedIds={props.reviewedIds}
          onSelect={props.onSelect}
        />
      </Show>

      <div class="flex items-center gap-2 justify-center">
        <Button variant="primary" onClick={props.onLooksGood}>
          {props.sendTargetName ? `send to ${props.sendTargetName}` : "looks good"}
          <Show when={hasNext()}>
            <svg
              class="inline ml-1"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M2 6h8M7 3l3 3-3 3"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </Show>
        </Button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------
// inline "sending to remote" panel - replaces the normal grouping/metadata
// content while a post-review send is in flight. no toasts for this flow.
// -------------------------------------------------------------------------

function SendProgressPanel(props: { progress: SendReviewProgress }) {
  const p = () => props.progress;
  const percent = () =>
    p().totalAlbums > 0 ? Math.round((p().completedAlbums / p().totalAlbums) * 100) : 0;

  return (
    <div class="flex flex-col gap-4 py-10 px-4">
      <div class="text-center">
        <h3 class="heading-6 text-[var(--color-text-primary)] mb-1">
          {p().done ? `sent to ${p().targetName}` : `sending to ${p().targetName}\u2026`}
        </h3>
        <p class="body-small text-[var(--color-text-secondary)]">
          {p().completedAlbums} of {p().totalAlbums} album{p().totalAlbums === 1 ? "" : "s"}
          {p().failedAlbums > 0 ? ` \u00b7 ${p().failedAlbums} failed` : ""}
        </p>
      </div>

      <div class="h-2 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
        <div
          class="h-full bg-[var(--color-accent-500)] rounded-full transition-all duration-300"
          style={{ width: `${percent()}%` }}
        />
      </div>

      <Show when={!p().done}>
        <div class="flex items-center justify-center gap-2">
          <Icon name="loader" size={16} className="animate-spin text-[var(--color-text-muted)]" />
          <Show when={p().currentAlbumTitle}>
            <p class="body-xs text-[var(--color-text-tertiary)]">
              {p().currentAlbumTitle} — {p().currentSongsDone}/{p().currentSongsTotal} songs
            </p>
          </Show>
        </div>
      </Show>

      <Show when={p().errors.length > 0}>
        <div class="rounded-lg border border-red-500/30 bg-red-500/10 p-3 max-h-32 overflow-y-auto space-y-1">
          <For each={p().errors}>{(err) => <p class="body-xs text-red-400">{err}</p>}</For>
        </div>
      </Show>
    </div>
  );
}

// -------------------------------------------------------------------------
// main export
// -------------------------------------------------------------------------

export function ImportReviewModal(props: ImportReviewModalProps) {
  const [stage, setStage] = createSignal<ImportReviewStage>("grouping");
  const [albumIndex, setAlbumIndex] = createSignal(0);
  const [reviewedIds, setReviewedIds] = createSignal<Set<string>>(new Set());

  // reset only when the modal opens (isOpen: false → true), NOT on every
  // albums change. reading props.albums.length without on() would make this
  // effect re-run on every refetch, calling setStage("grouping") while the
  // user is on the metadata tab, which unmounts the editor and resets all
  // tab state inside it (activeTab, MusicBrainzPanel search state, etc.).
  // inside the on() callback, reactive reads are untracked.
  createEffect(
    on(
      () => props.isOpen,
      (isOpen) => {
        if (isOpen) {
          setAlbumIndex(0);
          setReviewedIds(new Set<string>());
          setStage(props.albums.length === 1 ? "metadata" : "grouping");
        }
      }
    )
  );

  // also skip grouping when albums load for the first time with exactly one
  createEffect(() => {
    if (props.albums.length === 1 && stage() === "grouping") {
      setStage("metadata");
    }
  });

  const currentAlbum = createMemo(() => props.albums[albumIndex()] ?? props.albums[0]);

  //   const allReviewed = createMemo(
  //     () => props.albums.length > 0 && props.albums.every((a) => reviewedIds().has(a.id))
  //   );

  const markReviewed = (id: string) => {
    setReviewedIds((prev) => new Set([...prev, id]));
    props.onMarkReviewed(id);
  };

  const handleLooksGood = () => {
    const album = currentAlbum();
    if (album) markReviewed(album.id);
    if (albumIndex() < props.albums.length - 1) {
      setAlbumIndex((i) => i + 1);
    } else {
      // last album - auto-complete the review
      props.onComplete();
    }
  };

  const renderEditor = props.renderAlbumEditor ?? DefaultAlbumEditorStub;

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title="review import"
      size="xl"
      scrollBody
      zIndex={1200}
      disableBackdropClose
      footer={
        <Show
          when={!props.sendProgress}
          fallback={
            <div class="flex justify-center">
              <Button
                variant="primary"
                disabled={!props.sendProgress?.done}
                onClick={props.onClose}
              >
                {props.sendProgress?.done ? "close" : "sending\u2026"}
              </Button>
            </div>
          }
        >
          <Show when={stage() === "metadata"}>
            <MetadataFooter
              albums={props.albums}
              albumIndex={albumIndex()}
              reviewedIds={reviewedIds()}
              onSelect={setAlbumIndex}
              onLooksGood={handleLooksGood}
              sendTargetName={props.sendTargetName}
            />
          </Show>
        </Show>
      }
    >
      <div class="flex flex-col p-4">
        <Show
          when={!props.sendProgress}
          fallback={<SendProgressPanel progress={props.sendProgress!} />}
        >
          {/* step indicator - visible throughout both stages */}
          <Show when={!props.loading}>
            <StepIndicator current={stage()} />
          </Show>

          {/* loading state */}
          <Show when={props.loading}>
            <div class="flex flex-col items-center justify-center py-16 gap-3 text-[var(--color-text-muted)]">
              <Icon name="loader" size={28} color="currentColor" />
              <p class="body-small">loading albums...</p>
            </div>
          </Show>

          <Show when={!props.loading && stage() === "grouping"}>
            <ImportGroupingView
              albums={props.albums}
              onMerge={props.onMergeAlbums}
              onMoveSong={props.onMoveSong}
              onCreateAlbumForSong={props.onCreateAlbumForSong}
              onConfirm={() => {
                setStage("metadata");
                setAlbumIndex(0);
              }}
            />
          </Show>

          {/* the function-children pattern (_) => ... is critical here.
            when the children is a function with length > 0, SolidJS Show
            calls it inside untrack(). this means the reactive reads for
            album, albumIndex, etc. happen inside the component (via getter
            props), NOT in Show's outer createMemo. without this, every
            change to currentAlbum() (e.g. after a refetch) causes Show to
            re-evaluate and remount the entire editor, resetting activeTab. */}
          <Show when={stage() === "metadata" && currentAlbum()}>
            {(_) =>
              renderEditor({
                get album() {
                  return currentAlbum()!;
                },
                get albumIndex() {
                  return albumIndex();
                },
                get albumTotal() {
                  return props.albums.length;
                },
                get isReviewed() {
                  return reviewedIds().has(currentAlbum()!.id);
                },
                onPrev: () => setAlbumIndex((i) => Math.max(0, i - 1)),
                onNext: () => setAlbumIndex((i) => Math.min(props.albums.length - 1, i + 1)),
                onLooksGood: handleLooksGood,
              })
            }
          </Show>
        </Show>
      </div>
    </Modal>
  );
}
