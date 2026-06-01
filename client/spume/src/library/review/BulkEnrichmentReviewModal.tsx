// BulkEnrichmentReviewModal — phase 11 / slice 1.
//
// paginated wizard for bulk-reviewing the auto-derived taxon proposals
// for a batch of albums. parent (`bulkEnrichmentReview.ts`) owns the
// album cursor + the underlying enrichment session; this modal is a
// pure renderer that:
//
//   * fetches + displays proposals for the current album
//   * tracks per-(kind,label) selection
//   * polls per-album per-source enrichment status (so chips light up
//     as sources finish)
//   * on `[save & next]` applies the picked proposals + flips
//     `review_status='complete'` + advances
//   * on `[skip]` just advances (album stays `pending`)
//   * on `[dismiss]` flips `review_status='dismissed'` + advances
//   * on `[minimize]` closes the modal but leaves the session running
//   * on `[exit]` invokes the parent's onExit callback
//
// keyboard: j / →  next   ·   k / ←  prev   ·   esc closes (handled
// upstream by the Modal stack).

import {
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  onCleanup,
  onMount,
} from "solid-js";
import { Modal } from "../../components/modals/Modal";
import { Icon } from "../../components/icons/registry";
import { toast } from "../../components/feedback/Toast";
import { getClientForRemote } from "../../app/api/client";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { TaxonReviewPanel, proposalKey, type TaxonProposalLike } from "./TaxonReviewPanel";
import { ArtistBioReviewPanel } from "./ArtistBioReviewPanel";
import { RelatedArtistsReviewPanel } from "./RelatedArtistsReviewPanel";
import { ExternalUrlsReviewPanel, externalUrlKey } from "./ExternalUrlsReviewPanel";
import { ImagePickGrid } from "./ImagePickGrid";
import { BulkRequeryPanel } from "./BulkRequeryPanel";
import type { ComparisonSong } from "../../components/musicbrainz/MusicBrainzTrackComparison";
import type { MbReleaseDetail } from "../../music/data/types";
import { parseAlbumMetadata } from "../data/albumMetadata";
import { queryClient } from "../../queryClient";
import { useRemoteIsAdmin } from "../hooks/useRemoteRole";
import { PROGRESS_POLL_INTERVAL_MS, pickSource } from "./bulkEnrichmentReview/helpers";
import { ProgressBadges } from "./bulkEnrichmentReview/ProgressBadges";
import { ProgressErrorList } from "./bulkEnrichmentReview/ProgressErrorList";
import { RawDataPeekModals } from "./bulkEnrichmentReview/RawDataPeekModals";
import {
  TracksComparisonSection,
  buildMergedCandidates,
} from "./bulkEnrichmentReview/TracksComparisonSection";
import { useAuxiliaryReviewState } from "./bulkEnrichmentReview/useAuxiliaryReviewState";

export interface BulkEnrichmentReviewModalProps {
  ids: string[];
  currentIndex: number;
  remote: Remote;
  onNext: () => void;
  onPrev: () => void;
  onExit: () => void;
  onMinimize: () => void;
}

export function BulkEnrichmentReviewModal(props: BulkEnrichmentReviewModalProps) {
  const albumId = createMemo(() => props.ids[props.currentIndex] ?? null);
  const total = createMemo(() => props.ids.length);
  const hasPrev = createMemo(() => props.currentIndex > 0);
  const hasNext = createMemo(() => props.currentIndex < total() - 1);

  // load the album for the header strip + the inline requery panel.
  // we use `queryAlbums` (not `getAlbum`) so the same call gives us
  // the joined artist row (id + name) — needed both for the editable
  // artist field and for downstream `updateAlbum` calls when the user
  // renames things.
  //
  // bumped to force a refetch of the album row (after we mutate via
  // updateAlbum or after confirming a different mb match).
  const [albumReloadKey, setAlbumReloadKey] = createSignal(0);
  const albumKey = createMemo<[string | null, number] | null>(() => {
    const id = albumId();
    if (!id) return null;
    return [id, albumReloadKey()];
  });
  const [album, { refetch: _refetchAlbum }] = createResource(albumKey, async (k) => {
    if (!k) return null;
    const [id] = k;
    if (!id) return null;
    try {
      const client = await getClientForRemote(props.remote);
      const resp = await client.music.queryAlbums({
        q: null,
        search_fields: null,
        filters: { album_id: id },
        sort_by: null,
        sort_direction: null,
        limit: 1,
        offset: 0,
        user_id: null,
        favorites_only: null,
        min_rating: null,
      });
      if (!resp.success || !resp.data) return null;
      const item = resp.data.items[0];
      if (!item) return null;
      return {
        album_id: item.album.id,
        title: item.album.title,
        artist_id: item.artist?.id ?? null,
        artist_name: item.artist?.name ?? "",
        metadata: item.album.metadata ?? null,
      };
    } catch {
      return null;
    }
  });

  // load the album's songs (minimal shape) so the inline mb track
  // comparison ui can pair them against any candidate release. keyed
  // by albumId only — songs don't change as a side-effect of any of
  // the enrichment writes we do here, so no manual reload key.
  const [songs] = createResource(albumId, async (id) => {
    if (!id) return [];
    try {
      const client = await getClientForRemote(props.remote);
      const resp = await client.music.querySongs({
        q: null,
        search_fields: null,
        filters: { album_id: id },
        sort_by: "track_number",
        sort_direction: "asc",
        limit: 1000,
        offset: 0,
        user_id: null,
        favorites_only: null,
        min_rating: null,
      });
      if (!resp.success || !resp.data) return [];
      return resp.data.items.map((it) => ({
        id: it.song.id,
        title: it.song.title,
        disc_number: it.song.disc_number ?? 1,
        track_number: it.song.track_number ?? 0,
        duration_seconds: it.song.duration ?? 0,
        track_artist: it.song.track_artist ?? null,
      })) satisfies ComparisonSong[];
    } catch {
      return [];
    }
  });

  // admin gating — non-admins can still open the lastfm/audiodb peek
  // modals to read stored snapshots; the "fetch" buttons inside them
  // disable accordingly.
  const isRemoteAdmin = useRemoteIsAdmin(() => props.remote);

  // visibility flags for the two raw-data peek modals (moved out of
  // the library row actions per phase 11.x cleanup).
  const [showLastFm, setShowLastFm] = createSignal(false);
  const [showAudioDb, setShowAudioDb] = createSignal(false);
  // reset peek visibility when the album changes so we don't carry
  // a half-open snapshot of album N into album N+1.
  createEffect(
    on(albumId, () => {
      setShowLastFm(false);
      setShowAudioDb(false);
    })
  );

  const mergedCandidates = createMemo(() => {
    const a = album();
    return buildMergedCandidates(a?.metadata ?? null, a?.title ?? "", a?.artist_name ?? "");
  });

  // compare-tracks: top-level section rendered after the artist images
  // grid. user picks one mb release id from the merged-candidates
  // dropdown and we render the side-by-side track comparison.
  const [compareReleaseId, setCompareReleaseId] = createSignal<string | null>(null);
  // reset on album change.
  createEffect(on(albumId, () => setCompareReleaseId(null)));
  // default-pick: prefer the confirmed release id, otherwise the first
  // candidate that has a release_id (release-group-only candidates
  // can't power the comparison ui).
  createEffect(() => {
    if (compareReleaseId() != null) return;
    const a = album();
    if (!a) return;
    const meta = parseAlbumMetadata(a.metadata);
    const confirmed = meta.musicbrainz?.release_id ?? null;
    if (confirmed) {
      setCompareReleaseId(confirmed);
      return;
    }
    const firstWithRelease = mergedCandidates().find((c) => !!c.release_id);
    if (firstWithRelease?.release_id) {
      setCompareReleaseId(firstWithRelease.release_id);
    }
  });
  const [compareReleaseDetail] = createResource(compareReleaseId, async (rid) => {
    if (!rid) return null;
    try {
      const client = await getClientForRemote(props.remote);
      const resp = await client.music.getMusicbrainzRelease({ mbid: rid });
      if (!resp.success) return null;
      return (resp.data ?? null) as MbReleaseDetail | null;
    } catch {
      return null;
    }
  });

  // editable artist + title — seeded from the album row, reset every
  // time the visible album changes. these get sent on requery (as
  // override_query) and persisted via `updateAlbum` on save if dirty.
  //
  // we key the seeding off of `albumId` (not the `album` resource)
  // because `setAlbumReloadKey` after a requery / mb-confirm refetches
  // the album row — if we seeded off the resource itself, every
  // refetch would clobber whatever the user just typed.
  const [editedArtist, setEditedArtist] = createSignal("");
  const [editedTitle, setEditedTitle] = createSignal("");
  const [seededForId, setSeededForId] = createSignal<string | null>(null);
  createEffect(
    on(albumId, (id) => {
      // album id changed — clear edits + mark unseeded so the next
      // album resolution can fill them in.
      setEditedArtist("");
      setEditedTitle("");
      setSeededForId(null);
      void id;
    })
  );
  createEffect(() => {
    if (album.loading) return;
    const a = album();
    const id = albumId();
    if (!a || !id) return;
    if (seededForId() === id) return;
    setEditedArtist(a.artist_name ?? "");
    setEditedTitle(a.title ?? "");
    setSeededForId(id);
  });

  // proposals — refetched on album change AND when an enrichment source
  // for this album flips to a terminal state below.
  const [proposalReloadKey, setProposalReloadKey] = createSignal(0);
  const proposalsKey = createMemo<[string | null, number] | null>(() => {
    const id = albumId();
    if (!id) return null;
    return [id, proposalReloadKey()];
  });
  const [proposals, { refetch: refetchProposals }] = createResource(proposalsKey, async (k) => {
    if (!k) return [] as TaxonProposalLike[];
    const [id] = k;
    if (!id) return [] as TaxonProposalLike[];
    try {
      const client = await getClientForRemote(props.remote);
      const resp = await client.music.proposeTaxons({ album_id: id });
      if (!resp.success || !resp.data) return [] as TaxonProposalLike[];
      // server returns `TaxonProposal[]` directly (see route schema:
      // `resp: s.TaxonProposalSchema.array()`).
      return (resp.data as TaxonProposalLike[]) ?? [];
    } catch (err) {
      toast.error(`failed to load proposals: ${(err as Error).message}`);
      return [] as TaxonProposalLike[];
    }
  });

  // per-source enrichment progress for the visible album. polled while
  // the modal is open + the album hasn't reached terminal status across
  // all configured sources.
  type SourceProgress = {
    source: string;
    status: string;
    last_attempt_at?: number | null;
    last_error?: string | null;
    retry_count: number;
  };
  const [progress, setProgress] = createSignal<SourceProgress[]>([]);
  const lastTerminalSig = (() => {
    let prev = "";
    return (next: SourceProgress[]): boolean => {
      const sig = next
        .map((s) => `${s.source}:${s.status}`)
        .sort()
        .join("|");
      const changed = sig !== prev;
      prev = sig;
      return changed;
    };
  })();

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const stopPolling = () => {
    if (pollTimer != null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const pollProgress = async () => {
    const id = albumId();
    if (!id) return;
    try {
      const client = await getClientForRemote(props.remote);
      const resp = await client.music.getEnrichmentProgress({
        album_ids: [id],
      });
      if (!resp.success || !resp.data) return;
      const entry = resp.data.albums.find((a) => a.album_id === id);
      const sources = entry?.sources ?? [];
      setProgress(sources);
      // when any source flipped state, refetch proposals + the album
      // row to surface newly-arrived candidates (the mb candidates
      // list lives inside `album.metadata`, so without bumping
      // `albumReloadKey` the requery panel keeps showing stale data).
      if (lastTerminalSig(sources)) {
        setProposalReloadKey((k) => k + 1);
        setAlbumReloadKey((k) => k + 1);
      }
    } catch {
      // soft-fail — header badges just stay stale.
    }
  };

  // restart polling whenever the visible album changes.
  createEffect(
    on(albumId, (id) => {
      stopPolling();
      setProgress([]);
      if (!id) return;
      void pollProgress();
      pollTimer = setInterval(() => void pollProgress(), PROGRESS_POLL_INTERVAL_MS);
    })
  );
  onCleanup(stopPolling);

  // selection — keyed by `proposalKey()`. resets on album change so a
  // user can't leak picks from album N into album N+1.
  const [selected, setSelected] = createSignal<Set<string>>(new Set<string>());
  const [taxonsAutoFor, setTaxonsAutoFor] = createSignal<string | null>(null);
  createEffect(
    on(albumId, () => {
      setSelected(new Set<string>());
      setTaxonsAutoFor(null);
    })
  );
  // default-select every not-already-linked taxon proposal on first
  // arrival for a given album. user can toggle individual rows off.
  // gate on `!proposals.loading` so we don't default using the
  // previous album's stale data (which would mark the new album as
  // "already auto'd" and skip the real default once data arrives).
  createEffect(() => {
    if (proposals.loading) return;
    const list = proposals();
    if (!list || list.length === 0) return;
    const id = albumId();
    if (!id) return;
    if (taxonsAutoFor() === id) return;
    const next = new Set<string>();
    for (const p of list) {
      if (p.already_linked) continue;
      next.add(proposalKey(p));
    }
    setSelected(next);
    setTaxonsAutoFor(id);
  });

  // auxiliary review panels (bio / related artists / external urls /
  // album+artist images) live in their own state hook to keep this
  // file at a manageable size.
  const aux = useAuxiliaryReviewState({
    albumId,
    proposalReloadKey,
    remote: props.remote,
  });

  const toggleProposal = (p: TaxonProposalLike) => {
    if (p.already_linked) return;
    const key = proposalKey(p);
    setSelected((prev) => {
      const next = new Set<string>(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllFromSource = (source: string) => {
    setSelected((prev) => {
      const next = new Set<string>(prev);
      for (const p of proposals() ?? []) {
        if (p.already_linked) continue;
        if (p.sources.includes(source)) next.add(proposalKey(p));
      }
      return next;
    });
  };

  const clearAllUnlinked = () => setSelected(new Set<string>());

  // collect picks → applyTaxonProposals payload.
  type AcceptedSource = "mb" | "lastfm" | "audiodb";
  type AcceptedProposal = {
    kind_slug: string;
    label: string;
    source: AcceptedSource;
    confidence?: number | null;
  };
  const buildAcceptedPayload = (): AcceptedProposal[] => {
    const out: AcceptedProposal[] = [];
    const sel = selected();
    for (const p of proposals() ?? []) {
      if (p.already_linked) continue;
      if (!sel.has(proposalKey(p))) continue;
      // pick the highest-priority source available for attribution.
      const src = pickSource(p.sources);
      out.push({ kind_slug: p.kind_slug, label: p.label, source: src });
    }
    return out;
  };

  const [busy, setBusy] = createSignal(false);

  const applyAndAdvance = async (terminal: boolean) => {
    const id = albumId();
    if (!id) return;
    if (busy()) return;
    setBusy(true);
    try {
      const client = await getClientForRemote(props.remote);
      // persist any artist / title edits before doing anything else.
      // both flow through `updateAlbum` — passing artist_name (with no
      // artist_id) lets the server reuse-or-create the artist row.
      const a = album();
      if (a) {
        const newArtist = editedArtist().trim();
        const newTitle = editedTitle().trim();
        const artistDirty = newArtist.length > 0 && newArtist !== (a.artist_name ?? "").trim();
        const titleDirty = newTitle.length > 0 && newTitle !== (a.title ?? "").trim();
        if (artistDirty || titleDirty) {
          const upd = await client.music.updateAlbum({
            album_id: id,
            title: titleDirty ? newTitle : null,
            artist_id: null,
            artist_name: artistDirty ? newArtist : null,
            album_type: null,
            release_date: null,
            label: null,
            entity_urls: null,
            updated_by: null,
            merge_into_album_id: null,
          });
          if (!upd.success) {
            toast.error(upd.error.message || "failed to save album/artist edits");
            return;
          }
        }
      }
      // apply bio first (cheap, no cascading effects on taxons).
      if (aux.bioNeedsApply()) {
        const r = aux.bioResp()!;
        const src = aux.selectedBioSource()!;
        const bioApply = await client.music.applyArtistBio({
          artist_id: r.artist_id,
          source: src,
          text: aux.customBioText(),
        });
        if (!bioApply.success) {
          toast.error(bioApply.error.message || "failed to apply bio");
          return;
        }
      }
      // apply related-artist accept / reject decisions.
      if (aux.relatedNeedsApply()) {
        const r = aux.relatedResp();
        if (r) {
          const relApply = await client.music.applyRelatedArtists({
            artist_id: r.artist_id,
            accept_ids: [...aux.acceptRelatedIds()],
            reject_ids: [...aux.rejectRelatedIds()],
          });
          if (!relApply.success) {
            toast.error(relApply.error.message || "failed to apply related artists");
            return;
          }
        }
      }
      // apply external-url ingestions (mb url-rels, lf, audiodb).
      if (aux.externalUrlsNeedsApply()) {
        const r = aux.externalUrlsResp();
        if (r) {
          const accepted = r.proposals
            .filter((p) => aux.acceptExternalUrlKeys().has(externalUrlKey(p)))
            .map((p) => ({
              entity_type: p.entity_type,
              entity_id: p.entity_id,
              name: p.name,
              url: p.url,
            }));
          if (accepted.length > 0) {
            const urlApply = await client.music.applyExternalUrls({ accept: accepted });
            if (!urlApply.success) {
              toast.error(urlApply.error.message || "failed to apply external urls");
              return;
            }
          }
        }
      }
      const accepted = buildAcceptedPayload();
      if (accepted.length > 0) {
        const resp = await client.music.applyTaxonProposals({
          album_id: id,
          accepted,
        });
        if (!resp.success) {
          toast.error(resp.error.message || "failed to apply proposals");
          return;
        }
      }
      // ingest any user-selected remote images (album + artist).
      // sequential: avoid hammering the network + lets `is_primary`
      // logic see prior ingests' effects.
      const albumPicked = [...aux.selectedAlbumImageUrls()];
      const albumPanel = aux.albumImagesResp();
      const albumCandList = albumPanel?.candidates ?? [];
      let albumLinkedCount = albumPanel?.ingested_blob_ids.length ?? 0;
      for (const url of albumPicked) {
        const c = albumCandList.find((x) => x.url === url);
        if (!c) continue;
        const resp = await client.music.ingestRemoteImage({
          remote_url: url,
          target: { kind: "Album", id } as any,
          is_primary: albumLinkedCount === 0,
          source: c.source,
        });
        if (!resp.success) {
          toast.error(resp.error?.message || `album image ingest failed: ${url}`);
          return;
        }
        albumLinkedCount += 1;
      }
      const artistPicked = [...aux.selectedArtistImageUrls()];
      const artistPanel = aux.artistImagesResp();
      if (artistPicked.length > 0 && artistPanel) {
        let artistLinkedCount = artistPanel.ingested_blob_ids.length;
        const artistCandList = artistPanel.candidates;
        for (const url of artistPicked) {
          const c = artistCandList.find((x) => x.url === url);
          if (!c) continue;
          const resp = await client.music.ingestRemoteImage({
            remote_url: url,
            target: { kind: "Artist", id: artistPanel.artist_id } as any,
            is_primary: artistLinkedCount === 0,
            source: c.source,
          });
          if (!resp.success) {
            toast.error(resp.error?.message || `artist image ingest failed: ${url}`);
            return;
          }
          artistLinkedCount += 1;
        }
      }
      const statusResp = await client.music.setMbLookupStatus({
        album_id: id,
        status: "enriched",
      });
      if (!statusResp.success) {
        toast.error(statusResp.error.message || "failed to mark album enriched");
        return;
      }
      // refresh the library table so the row's status column reflects
      // the new mb_lookup_status without a manual reload.
      void queryClient.invalidateQueries({
        queryKey: ["library-albums", props.remote.remote_id],
      });
      if (terminal && !hasNext()) {
        props.onExit();
      } else {
        props.onNext();
      }
    } catch (err) {
      toast.error(`save failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const skipAndAdvance = async () => {
    if (busy()) return;
    const id = albumId();
    // mark `mb_lookup_status='skipped'` so the library view's filter
    // chips can pile these up under their own bucket. fire-and-forget
    // (best effort): a failure here shouldn't block the user from
    // moving on.
    if (id) {
      try {
        const client = await getClientForRemote(props.remote);
        const resp = await client.music.setMbLookupStatus({
          album_id: id,
          status: "skipped",
        });
        if (!resp.success) {
          toast.error(resp.error.message || "failed to mark album skipped");
        } else {
          void queryClient.invalidateQueries({
            queryKey: ["library-albums", props.remote.remote_id],
          });
        }
      } catch (err) {
        toast.error(`skip failed: ${(err as Error).message}`);
      }
    }
    if (hasNext()) props.onNext();
    else props.onExit();
  };

  // dismiss/minimize/exit footer buttons were removed (phase 11.x
  // cleanup) — modal close now goes through the shell's X /
  // escape / backdrop only. `props.onMinimize` stays in the props
  // surface so external callers (App.tsx) don't need rewiring; it's
  // wired below to the modal's onClose alongside `props.onExit` so
  // the parent's hide-vs-cancel state machine still works.
  // keyboard nav. ignored when typing in inputs/textareas/contenteditable.
  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable)
          return;
      }
      if (e.key === "j" || e.key === "ArrowRight") {
        if (hasNext()) {
          e.preventDefault();
          props.onNext();
        }
      } else if (e.key === "k" || e.key === "ArrowLeft") {
        if (hasPrev()) {
          e.preventDefault();
          props.onPrev();
        }
      }
    };
    window.addEventListener("keydown", handler);
    onCleanup(() => window.removeEventListener("keydown", handler));
  });

  const acceptedCount = createMemo(() => {
    const sel = selected();
    let n = 0;
    for (const p of proposals() ?? []) {
      if (!p.already_linked && sel.has(proposalKey(p))) n++;
    }
    return n;
  });

  // footer "N selected" — union across every panel that contributes to
  // an apply payload (taxons, bio, related artists, external urls,
  // album + artist images, and the artist/title text edits when
  // dirty). prior version only counted taxon picks, which under-
  // reported in every other panel.
  const totalSelectedCount = createMemo(() => {
    let n = acceptedCount();
    if (aux.bioNeedsApply()) n += 1;
    n += aux.acceptRelatedIds().size + aux.rejectRelatedIds().size;
    n += aux.acceptExternalUrlKeys().size;
    n += aux.selectedAlbumImageUrls().size;
    n += aux.selectedArtistImageUrls().size;
    const a = album();
    if (a) {
      const newArtist = editedArtist().trim();
      const newTitle = editedTitle().trim();
      if (newArtist.length > 0 && newArtist !== (a.artist_name ?? "").trim()) n += 1;
      if (newTitle.length > 0 && newTitle !== (a.title ?? "").trim()) n += 1;
    }
    return n;
  });

  const isProposalsEmpty = createMemo(() => {
    const list = proposals();
    if (list === undefined) return false; // still loading
    if (list.length === 0) return true;
    return list.every((p) => p.already_linked);
  });

  const headerTitle = createMemo(() => {
    const a = album();
    if (a) return a.title;
    return "loading…";
  });

  return (
    <Modal
      isOpen={true}
      onClose={() => props.onExit()}
      size="xl"
      disableBackdropClose
      title={`${props.currentIndex + 1} / ${total()} — ${headerTitle()}`}
      headerActions={
        <div class="flex items-center gap-3 text-xs">
          <ProgressBadges
            progress={progress()}
            onClickSource={(s) => {
              if (s === "lastfm") setShowLastFm(true);
              else if (s === "audiodb") setShowAudioDb(true);
            }}
          />
          <ProgressErrorList progress={progress()} />
          <button
            type="button"
            onClick={() => props.onPrev()}
            disabled={!hasPrev() || busy()}
            class="p-1 rounded hover:bg-[var(--color-bg-hover)] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            aria-label="previous album"
            title="prev (k / ←)"
          >
            <Icon name="chevronLeft" size={16} />
          </button>
          <button
            type="button"
            onClick={() => props.onNext()}
            disabled={!hasNext() || busy()}
            class="p-1 rounded hover:bg-[var(--color-bg-hover)] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            aria-label="next album"
            title="next (j / →)"
          >
            <Icon name="chevronRight" size={16} />
          </button>
        </div>
      }
      footer={
        <div class="flex items-center justify-between gap-2 p-3 border-t border-[var(--color-border-default)]">
          <div class="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <Show when={totalSelectedCount() > 0}>
              <span>{totalSelectedCount()} selected</span>
            </Show>
            <Show when={isProposalsEmpty() && proposals() !== undefined}>
              <span class="italic">nothing new to review · save & next flips to complete</span>
            </Show>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              onClick={() => skipAndAdvance()}
              disabled={busy()}
              class="px-3 py-1.5 rounded text-xs border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] cursor-pointer disabled:opacity-50"
              title="leave as pending and move on"
            >
              skip
            </button>
            <button
              type="button"
              onClick={() => void applyAndAdvance(false)}
              disabled={busy()}
              class="px-3 py-1.5 rounded text-xs bg-[var(--color-accent-500)] text-white hover:opacity-90 cursor-pointer disabled:opacity-50 border border-[var(--color-accent-500)]"
            >
              {busy() ? "saving…" : hasNext() ? "save & next" : "save & finish"}
            </button>
          </div>
        </div>
      }
    >
      <div class="p-4 flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto">
        {/* TEMP DEBUG: log every render of the wizard body so we can
            see which resources have data on each tick. remove once the
            reactivity weirdness is settled. */}
        {(() => {
          // eslint-disable-next-line no-console
          console.log("[BulkReview] render", {
            albumId: albumId(),
            currentIndex: props.currentIndex,
            proposalsState: proposals.state,
            proposalsLen: proposals()?.length,
            bioState: aux.bioResp.state,
            bioProposalsLen: aux.bioResp()?.proposals.length,
            relatedState: aux.relatedResp.state,
            relatedProposalsLen: aux.relatedResp()?.proposals.length,
            albumImagesState: aux.albumImagesResp.state,
            albumCandidatesLen: aux.albumImagesResp()?.candidates.length,
            artistImagesState: aux.artistImagesResp.state,
            artistCandidatesLen: aux.artistImagesResp()?.candidates.length,
          });
          return null;
        })()}
        <Show
          when={proposals() !== undefined}
          fallback={
            <div class="text-xs text-[var(--color-text-disabled)] italic">loading proposals…</div>
          }
        >
          <Show when={album() && albumId()}>
            <BulkRequeryPanel
              albumId={albumId()!}
              remote={props.remote}
              metadataRaw={album()?.metadata ?? null}
              initialArtist={album()?.artist_name ?? ""}
              initialTitle={album()?.title ?? ""}
              artist={editedArtist()}
              title={editedTitle()}
              onArtistChange={setEditedArtist}
              onTitleChange={setEditedTitle}
              onChanged={() => {
                setProposalReloadKey((k) => k + 1);
                setAlbumReloadKey((k) => k + 1);
                // poll immediately so the user sees the new job's
                // status (queued/running) without waiting for the
                // 5s timer.
                void pollProgress();
              }}
            />
          </Show>
          <TaxonReviewPanel
            proposals={proposals() ?? []}
            selected={selected()}
            onToggle={toggleProposal}
            onSelectAllFromSource={selectAllFromSource}
            onClearAllUnlinked={clearAllUnlinked}
          />
        </Show>
        <Show when={(aux.bioResp()?.proposals.length ?? 0) > 0}>
          <ArtistBioReviewPanel
            artistName={null}
            proposals={aux.bioResp()?.proposals ?? []}
            selectedSource={aux.selectedBioSource()}
            customText={aux.customBioText()}
            onSelect={aux.onPickBio}
            onCustomChange={aux.setCustomBioText}
          />
        </Show>
        <Show when={aux.relatedResp() !== undefined}>
          <RelatedArtistsReviewPanel
            proposals={aux.relatedResp()?.proposals ?? []}
            acceptIds={aux.acceptRelatedIds()}
            rejectIds={aux.rejectRelatedIds()}
            onToggleAccept={aux.toggleAcceptRelated}
            onToggleReject={aux.toggleRejectRelated}
            onAcceptAll={aux.acceptAllRelated}
            onClear={aux.clearRelated}
          />
        </Show>
        <Show when={aux.externalUrlsResp() !== undefined}>
          <ExternalUrlsReviewPanel
            proposals={aux.externalUrlsResp()?.proposals ?? []}
            acceptKeys={aux.acceptExternalUrlKeys()}
            onToggle={aux.toggleExternalUrl}
            onAcceptAll={aux.acceptAllExternalUrls}
            onClear={aux.clearExternalUrls}
          />
        </Show>
        <Show when={aux.albumImagesResp() !== undefined}>
          <ImagePickGrid
            title="album images"
            candidates={aux.albumImagesResp()?.candidates ?? []}
            ingestedCount={aux.albumImagesResp()?.ingested_blob_ids.length ?? 0}
            selected={aux.selectedAlbumImageUrls()}
            onToggle={aux.onToggleAlbumImage}
          />
        </Show>
        <Show when={aux.artistImagesResp() !== undefined}>
          <ImagePickGrid
            title="artist images"
            candidates={aux.artistImagesResp()?.candidates ?? []}
            ingestedCount={aux.artistImagesResp()?.ingested_blob_ids.length ?? 0}
            selected={aux.selectedArtistImageUrls()}
            onToggle={aux.onToggleArtistImage}
          />
        </Show>
        <TracksComparisonSection
          songs={songs() ?? []}
          mergedCandidates={mergedCandidates()}
          compareReleaseId={compareReleaseId()}
          setCompareReleaseId={setCompareReleaseId}
          compareReleaseDetail={compareReleaseDetail}
          remote={props.remote}
          onAlbumUpdated={() => {
            setProposalReloadKey((k) => k + 1);
            setAlbumReloadKey((k) => k + 1);
          }}
        />
        <Show when={refetchProposals as unknown}>
          <></>
        </Show>
      </div>
      <RawDataPeekModals
        album={album() ?? null}
        remote={props.remote}
        isAdmin={isRemoteAdmin()}
        showLastFm={showLastFm()}
        showAudioDb={showAudioDb()}
        onCloseLastFm={() => setShowLastFm(false)}
        onCloseAudioDb={() => setShowAudioDb(false)}
      />
    </Modal>
  );
}
