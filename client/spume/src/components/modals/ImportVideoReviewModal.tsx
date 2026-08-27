// modal shell for the two-stage video import review flow.
// stage 1: series/group grouping (ImportVideoGroupingView)
// stage 2: per-group metadata (renderGroupEditor render prop)
//
// mirrors components/modals/ImportReviewModal.tsx - see that file for the
// music equivalent (which additionally supports album merging).
import { For, Show, createSignal, createMemo, createEffect, on, type JSX } from "solid-js";
import { Modal } from "./Modal";
import { Button } from "../buttons/Button";
import { MediaImage } from "../media/MediaImage";
import { Icon } from "../icons/registry";
import { ImportVideoGroupingView } from "../import/ImportVideoGroupingView";
import type { ImportReviewVideoGroup } from "../../video/hooks/useVideoImportReview";

export type ImportVideoReviewStage = "grouping" | "metadata";

export interface ImportVideoReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  groups: ImportReviewVideoGroup[];
  loading?: boolean;
  onComplete: () => void;
  onMoveVideo: (videoId: string, toSeriesId: string | null) => void;
  onMarkReviewed: (groupKey: string) => void | Promise<void>;
  renderGroupEditor?: (editorProps: VideoGroupEditorRenderProps) => JSX.Element;
}

export interface VideoGroupEditorRenderProps {
  group: ImportReviewVideoGroup;
  groupIndex: number;
  groupTotal: number;
  isReviewed: boolean;
  onPrev: () => void;
  onNext: () => void;
  onLooksGood: () => void;
}

const STEPS: { id: ImportVideoReviewStage; label: string }[] = [
  { id: "grouping", label: "1. check videos" },
  { id: "metadata", label: "2. fix metadata" },
];

function StepIndicator(props: { current: ImportVideoReviewStage }) {
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

function DefaultGroupEditorStub(props: VideoGroupEditorRenderProps) {
  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-3 p-4 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)]">
        <MediaImage
          remoteBlobId={props.group.posterBlobId}
          remoteServerId={props.group.remoteServerId}
          imageUrl={props.group.posterUrl}
          alt=""
          size="sm"
          thumbnailSize={200}
          class="w-14 h-14 rounded object-cover flex-shrink-0"
          showFallback
          domainType="video_series"
        />
        <div>
          <p class="body-base font-medium text-[var(--color-text-primary)]">
            {props.group.seriesTitle ?? props.group.videos[0]?.title ?? "untitled"}
          </p>
          <p class="body-small text-[var(--color-text-secondary)]">
            {props.group.videos.length} video{props.group.videos.length !== 1 ? "s" : ""}
          </p>
          <Show when={props.isReviewed}>
            <p class="body-xs text-[var(--color-success-fg,#22c55e)] mt-0.5">reviewed</p>
          </Show>
        </div>
      </div>
    </div>
  );
}

function GroupDots(props: {
  groups: ImportReviewVideoGroup[];
  currentIndex: number;
  reviewedKeys: Set<string>;
  onSelect: (i: number) => void;
}) {
  return (
    <div class="flex items-center gap-1.5 justify-center flex-wrap">
      <For each={props.groups}>
        {(group, i) => {
          const isActive = () => i() === props.currentIndex;
          const isReviewed = () => props.reviewedKeys.has(group.groupKey);
          return (
            <button
              class={`w-2.5 h-2.5 rounded-full transition-all ${
                isActive()
                  ? "bg-[var(--color-text-primary)] scale-125"
                  : isReviewed()
                    ? "bg-[var(--color-accent-500)] opacity-70"
                    : "bg-[var(--color-border-default)] hover:bg-[var(--color-text-muted)]"
              }`}
              title={group.seriesTitle ?? undefined}
              aria-label={`group ${i() + 1}: ${group.seriesTitle ?? "untitled"}`}
              aria-current={isActive() ? "true" : undefined}
              onClick={() => props.onSelect(i())}
            />
          );
        }}
      </For>
    </div>
  );
}

function MetadataFooter(props: {
  groups: ImportReviewVideoGroup[];
  groupIndex: number;
  reviewedKeys: Set<string>;
  onSelect: (i: number) => void;
  onLooksGood: () => void;
}) {
  const hasNext = () => props.groupIndex < props.groups.length - 1;
  return (
    <div class="flex flex-col gap-3 pt-3 border-t border-[var(--color-border-subtle)]">
      <Show when={props.groups.length > 1}>
        <GroupDots
          groups={props.groups}
          currentIndex={props.groupIndex}
          reviewedKeys={props.reviewedKeys}
          onSelect={props.onSelect}
        />
      </Show>
      <div class="flex items-center gap-2 justify-center">
        <Button variant="primary" onClick={props.onLooksGood}>
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
    </div>
  );
}

export function ImportVideoReviewModal(props: ImportVideoReviewModalProps) {
  const [stage, setStage] = createSignal<ImportVideoReviewStage>("grouping");
  const [groupIndex, setGroupIndex] = createSignal(0);
  const [reviewedKeys, setReviewedKeys] = createSignal<Set<string>>(new Set());

  createEffect(
    on(
      () => props.isOpen,
      (isOpen) => {
        if (isOpen) {
          setGroupIndex(0);
          setReviewedKeys(new Set<string>());
          setStage(props.groups.length === 1 ? "metadata" : "grouping");
        }
      }
    )
  );

  createEffect(() => {
    if (props.groups.length === 1 && stage() === "grouping") {
      setStage("metadata");
    }
  });

  const currentGroup = createMemo(() => props.groups[groupIndex()] ?? props.groups[0]);

  const handleLooksGood = async () => {
    const group = currentGroup();
    if (!group) return;
    // wait for the save (and its server-side mark-reviewed) to actually
    // finish before advancing - the editor shows its own inline error and
    // stays put on failure, instead of a toast disconnected from a group
    // the user has already been advanced away from.
    try {
      await props.onMarkReviewed(group.groupKey);
    } catch {
      return;
    }
    setReviewedKeys((prev) => new Set([...prev, group.groupKey]));
    if (groupIndex() < props.groups.length - 1) {
      setGroupIndex((i) => i + 1);
    } else {
      props.onComplete();
    }
  };

  const renderEditor = props.renderGroupEditor ?? DefaultGroupEditorStub;

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title="review video import"
      size="xl"
      scrollBody
      zIndex={1200}
      disableBackdropClose
      footer={
        <Show when={stage() === "metadata"}>
          <MetadataFooter
            groups={props.groups}
            groupIndex={groupIndex()}
            reviewedKeys={reviewedKeys()}
            onSelect={setGroupIndex}
            onLooksGood={handleLooksGood}
          />
        </Show>
      }
    >
      <div class="flex flex-col p-4">
        <Show when={!props.loading}>
          <StepIndicator current={stage()} />
        </Show>

        <Show when={props.loading}>
          <div class="flex flex-col items-center justify-center py-16 gap-3 text-[var(--color-text-muted)]">
            <Icon name="loader" size={28} color="currentColor" />
            <p class="body-small">loading videos...</p>
          </div>
        </Show>

        <Show when={!props.loading && stage() === "grouping"}>
          <ImportVideoGroupingView
            groups={props.groups}
            onMoveVideo={props.onMoveVideo}
            onConfirm={() => {
              setStage("metadata");
              setGroupIndex(0);
            }}
          />
        </Show>

        {/* function-children pattern - see ImportReviewModal.tsx's identical
            comment for why this avoids remounting the editor on refetch. */}
        <Show when={stage() === "metadata" && currentGroup()}>
          {(_) =>
            renderEditor({
              get group() {
                return currentGroup()!;
              },
              get groupIndex() {
                return groupIndex();
              },
              get groupTotal() {
                return props.groups.length;
              },
              get isReviewed() {
                return reviewedKeys().has(currentGroup()!.groupKey);
              },
              onPrev: () => setGroupIndex((i) => Math.max(0, i - 1)),
              onNext: () => setGroupIndex((i) => Math.min(props.groups.length - 1, i + 1)),
              onLooksGood: handleLooksGood,
            })
          }
        </Show>
      </div>
    </Modal>
  );
}
