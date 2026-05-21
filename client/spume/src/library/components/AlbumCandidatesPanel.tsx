// AlbumCandidatesPanel — phase 7 review surface.
//
// rendered inline beneath an album row when its mb_lookup_status is
// "candidates" or "needs_review" (or, optionally, "confirmed" so the user
// can revisit alternatives). lists the stored mb candidates ranked by
// local_confidence and offers per-row [confirm] / [open in MB] actions
// plus a global [reject all].
//
// progress UX: per-action mutation state is shown inline next to the
// triggering button (no toasts, per ux directive). on success the
// `["library-albums", remote_id]` query is invalidated so the table
// reflects the new mb_lookup_status.

import { createSignal, For, Show } from "solid-js";
import type { Remote } from "../../app/services/storage/schemas/remote";
import type { AlbumSummary } from "../../music/data/types";
import { getClientForRemote } from "../../app/api/client";
import { queryClient } from "../../queryClient";
import { Icon } from "../../components/icons/registry";
import {
  mbSearchStageLabel,
  parseAlbumMetadata,
  type AlbumMetadata,
  type MbCandidate,
} from "../data/albumMetadata";

interface AlbumCandidatesPanelProps {
  album: AlbumSummary;
  remote: Remote;
}

type PendingAction =
  | { kind: "idle" }
  | { kind: "confirming"; releaseGroupId: string }
  | { kind: "rejecting" }
  | { kind: "error"; message: string };

const MB_RELEASE_BASE = "https://musicbrainz.org/release";
const MB_RELEASE_GROUP_BASE = "https://musicbrainz.org/release-group";

export function AlbumCandidatesPanel(props: AlbumCandidatesPanelProps) {
  const meta = (): AlbumMetadata => parseAlbumMetadata(props.album.metadata);
  const candidates = (): MbCandidate[] => {
    const list = meta().musicbrainz?.candidates ?? [];
    return [...list].sort((a, b) => (b.local_confidence ?? 0) - (a.local_confidence ?? 0));
  };
  const confirmedReleaseGroupId = () => meta().musicbrainz?.release_group_id ?? null;

  const [pending, setPending] = createSignal<PendingAction>({ kind: "idle" });

  const invalidateAlbums = () => {
    void queryClient.invalidateQueries({
      queryKey: ["library-albums", props.remote.remote_id],
    });
  };

  const onConfirm = async (cand: MbCandidate) => {
    setPending({ kind: "confirming", releaseGroupId: cand.release_group_id });
    try {
      const client = await getClientForRemote(props.remote);
      const resp = await client.music.confirmMbMatch({
        album_id: props.album.album_id,
        release_group_id: cand.release_group_id,
        release_id: cand.release_id ?? null,
      });
      if (!resp.success) {
        setPending({ kind: "error", message: resp.error.message });
        return;
      }
      invalidateAlbums();
      setPending({ kind: "idle" });
    } catch (e) {
      setPending({ kind: "error", message: (e as Error).message });
    }
  };

  const onRejectAll = async () => {
    setPending({ kind: "rejecting" });
    try {
      const client = await getClientForRemote(props.remote);
      const resp = await client.music.rejectMbMatch({
        album_id: props.album.album_id,
      });
      if (!resp.success) {
        setPending({ kind: "error", message: resp.error.message });
        return;
      }
      invalidateAlbums();
      setPending({ kind: "idle" });
    } catch (e) {
      setPending({ kind: "error", message: (e as Error).message });
    }
  };

  const isBusy = () => {
    const p = pending();
    return p.kind === "confirming" || p.kind === "rejecting";
  };

  return (
    <div class="px-4 py-3 bg-[var(--color-bg-elevated)]/40 border-l-2 border-[var(--color-accent-500)]/40">
      <Show
        when={candidates().length > 0}
        fallback={
          <div class="text-xs text-[var(--color-text-muted)] py-2">
            no candidates stored — re-run lookup to fetch matches
          </div>
        }
      >
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <div class="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
              musicbrainz candidates ({candidates().length})
            </div>
            <Show when={meta().musicbrainz?.last_query?.stage}>
              {(stage) => {
                const isNonStrict = () => stage() !== "strict" && stage() !== "direct_lookup";
                return (
                  <span
                    class="text-[10px] px-1.5 py-0.5 rounded"
                    classList={{
                      "bg-amber-500/15 text-amber-400": isNonStrict(),
                      "bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]":
                        !isNonStrict(),
                    }}
                    title={`cascade stage: ${stage()}`}
                  >
                    {mbSearchStageLabel(stage())}
                  </span>
                );
              }}
            </Show>
          </div>
          <button
            type="button"
            class="text-[11px] px-2 py-0.5 rounded border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-transparent"
            disabled={isBusy()}
            onClick={onRejectAll}
          >
            <Show when={pending().kind === "rejecting"} fallback="reject all">
              rejecting…
            </Show>
          </button>
        </div>

        <Show when={pending().kind === "error"}>
          {(_) => {
            const p = pending();
            const msg = p.kind === "error" ? p.message : "";
            return (
              <div class="text-[11px] text-rose-400 mb-2 flex items-center gap-1">
                <Icon name="alertTriangle" size={10} />
                {msg}
              </div>
            );
          }}
        </Show>

        <ul class="flex flex-col gap-1.5">
          <For each={candidates()}>
            {(cand) => {
              const isConfirmed = () => confirmedReleaseGroupId() === cand.release_group_id;
              const isThisConfirming = () => {
                const p = pending();
                return p.kind === "confirming" && p.releaseGroupId === cand.release_group_id;
              };
              const mbHref = () =>
                cand.release_id
                  ? `${MB_RELEASE_BASE}/${cand.release_id}`
                  : `${MB_RELEASE_GROUP_BASE}/${cand.release_group_id}`;

              return (
                <li
                  class="flex items-start gap-2 px-2 py-1.5 rounded text-xs"
                  classList={{
                    "bg-emerald-500/10 border border-emerald-500/30": isConfirmed(),
                    "bg-[var(--color-bg-base)] border border-[var(--color-border-subtle)]":
                      !isConfirmed(),
                  }}
                >
                  {/* cover-art-archive thumb. cover art archive serves a 250px
                   *  redirect at /release/{id}/front-250; if the release has
                   *  no art the request 404s and the broken-img is hidden via
                   *  onError. lazy-loaded so off-screen rows don't trigger
                   *  network. */}
                  <Show
                    when={cand.release_id}
                    fallback={
                      <div class="w-10 h-10 rounded bg-[var(--color-bg-elevated)] shrink-0" />
                    }
                  >
                    <img
                      src={`https://coverartarchive.org/release/${cand.release_id}/front-250`}
                      alt=""
                      loading="lazy"
                      width={40}
                      height={40}
                      class="w-10 h-10 rounded object-cover bg-[var(--color-bg-elevated)] shrink-0"
                      onError={(e) => {
                        e.currentTarget.style.visibility = "hidden";
                      }}
                    />
                  </Show>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="text-[var(--color-text-primary)] font-medium truncate">
                        {cand.title}
                      </span>
                      <Show when={cand.artist}>
                        <span class="text-[var(--color-text-secondary)]">— {cand.artist}</span>
                      </Show>
                      <Show when={isConfirmed()}>
                        <span class="text-[10px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                          confirmed
                        </span>
                      </Show>
                    </div>
                    <div class="flex items-center gap-3 mt-0.5 text-[10px] text-[var(--color-text-muted)] flex-wrap">
                      <Show when={cand.first_release_date}>
                        <span>{cand.first_release_date?.slice(0, 4)}</span>
                      </Show>
                      <Show when={cand.track_count != null}>
                        <span>{cand.track_count} tracks</span>
                      </Show>
                      <Show when={cand.country}>
                        <span>{cand.country}</span>
                      </Show>
                      <Show when={cand.primary_type}>
                        <span>{cand.primary_type}</span>
                      </Show>
                      <Show when={cand.local_confidence != null}>
                        <span class="text-[var(--color-accent-500)]">
                          conf {((cand.local_confidence ?? 0) * 100).toFixed(0)}%
                        </span>
                      </Show>
                      <Show when={cand.mb_score != null}>
                        <span>mb {cand.mb_score}</span>
                      </Show>
                      <Show when={(cand.cover_art_count ?? 0) > 0}>
                        <span>
                          {cand.cover_art_count} img{cand.cover_art_count !== 1 ? "s" : ""}
                        </span>
                      </Show>
                    </div>
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <a
                      href={mbHref()}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-[10px] px-2 py-0.5 rounded border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-secondary)] no-underline"
                      title="open in musicbrainz.org"
                      onClick={(e) => e.stopPropagation()}
                    >
                      MB ↗
                    </a>
                    <button
                      type="button"
                      class="text-[10px] px-2 py-0.5 rounded border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-transparent"
                      disabled={isBusy() || isConfirmed()}
                      onClick={(e) => {
                        e.stopPropagation();
                        void onConfirm(cand);
                      }}
                    >
                      <Show
                        when={isThisConfirming()}
                        fallback={isConfirmed() ? "confirmed" : "confirm"}
                      >
                        confirming…
                      </Show>
                    </button>
                  </div>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </div>
  );
}
