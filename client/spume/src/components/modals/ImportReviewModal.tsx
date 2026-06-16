// modal shell for the two-stage import metadata review flow.
// stage 1: album grouping (ImportGroupingView)
// stage 2: per-album metadata (placeholder for BulkEnrichmentReviewModal integration)
//
// all data fetching is the caller's responsibility - this component is presentational.
import { For, Show, createSignal, createMemo, createEffect, type JSX } from "solid-js";
import { Modal } from "./Modal";
import { Button } from "../buttons/Button";
import { MediaImage } from "../media/MediaImage";
import { Icon } from "../icons/registry";
import { ImportGroupingView, type ImportReviewAlbum } from "../import/ImportGroupingView";

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
  onMarkReviewed: (albumId: string) => void;
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
  allReviewed: boolean;
  onSelect: (i: number) => void;
  onLooksGood: () => void;
  onFinish: () => void;
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

      {/* per-album action */}
      <div class="flex items-center gap-2 justify-center">
        <Button variant="secondary" onClick={props.onLooksGood}>
          looks good
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

      {/* finish row - primary button lives here and only here */}
      <div class="flex justify-end items-center gap-3 pt-1 border-t border-[var(--color-border-subtle)]">
        <Show when={!props.allReviewed}>
          <button
            class="body-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] underline transition-colors"
            onClick={props.onFinish}
          >
            finish anyway
          </button>
        </Show>
        <Button variant="primary" disabled={!props.allReviewed} onClick={props.onFinish}>
          finish review
        </Button>
      </div>
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

  // reset to grouping stage whenever the modal opens
  createEffect(() => {
    if (props.isOpen) {
      setAlbumIndex(0);
      setReviewedIds(new Set<string>());
      // skip grouping when there's only one album - jump straight to metadata
      setStage(props.albums.length === 1 ? "metadata" : "grouping");
    }
  });

  // also skip grouping when albums load for the first time with exactly one
  createEffect(() => {
    if (props.albums.length === 1 && stage() === "grouping") {
      setStage("metadata");
    }
  });

  const currentAlbum = createMemo(() => props.albums[albumIndex()] ?? props.albums[0]);

  const allReviewed = createMemo(
    () => props.albums.length > 0 && props.albums.every((a) => reviewedIds().has(a.id))
  );

  const markReviewed = (id: string) => {
    setReviewedIds((prev) => new Set([...prev, id]));
    props.onMarkReviewed(id);
  };

  const handleLooksGood = () => {
    const album = currentAlbum();
    if (album) markReviewed(album.id);
    if (albumIndex() < props.albums.length - 1) setAlbumIndex((i) => i + 1);
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
      footer={
        <Show when={!props.loading && stage() === "metadata"}>
          <MetadataFooter
            albums={props.albums}
            albumIndex={albumIndex()}
            reviewedIds={reviewedIds()}
            allReviewed={allReviewed()}
            onSelect={setAlbumIndex}
            onLooksGood={handleLooksGood}
            onFinish={() => props.onComplete()}
          />
        </Show>
      }
    >
      <div class="flex flex-col p-4">
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
            onConfirm={() => {
              setStage("metadata");
              setAlbumIndex(0);
            }}
          />
        </Show>

        <Show when={!props.loading && stage() === "metadata" && currentAlbum()}>
          {renderEditor({
            album: currentAlbum()!,
            albumIndex: albumIndex(),
            albumTotal: props.albums.length,
            isReviewed: reviewedIds().has(currentAlbum()!.id),
            onPrev: () => setAlbumIndex((i) => Math.max(0, i - 1)),
            onNext: () => setAlbumIndex((i) => Math.min(props.albums.length - 1, i + 1)),
            onLooksGood: handleLooksGood,
          })}
        </Show>
      </div>
    </Modal>
  );
}
