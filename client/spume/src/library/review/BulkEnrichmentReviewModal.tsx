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
  For,
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
import {
  ArtistBioReviewPanel,
  type BioProposalLike,
  type BioSourceLike,
} from "./ArtistBioReviewPanel";
import {
  RelatedArtistsReviewPanel,
  type RelatedArtistProposalLike,
} from "./RelatedArtistsReviewPanel";
import {
  ExternalUrlsReviewPanel,
  externalUrlKey,
  type ExternalUrlProposalLike,
} from "./ExternalUrlsReviewPanel";
import { ImagePickGrid, type ImageCandidateLike } from "./ImagePickGrid";
import { BulkRequeryPanel } from "./BulkRequeryPanel";

const PROGRESS_POLL_INTERVAL_MS = 5000;

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
      }));
    } catch {
      return [];
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

  // ---- artist bio (slice 4a) ----
  // server resolves album_id -> artist_id and returns the bio
  // candidates in one call, so we don't need a separate song fetch.
  const [bioReloadKey, setBioReloadKey] = createSignal(0);
  const bioKey = createMemo<[string | null, number] | null>(() => {
    const id = albumId();
    if (!id) return null;
    return [id, bioReloadKey()];
  });
  const [bioResp] = createResource(bioKey, async (k) => {
    // eslint-disable-next-line no-console
    console.log("[BulkReview] bioResp fetcher fired", k);
    if (!k) return null;
    const [id] = k;
    if (!id) return null;
    try {
      const client = await getClientForRemote(props.remote);
      const resp = await client.music.proposeArtistBios({ album_id: id });
      // eslint-disable-next-line no-console
      console.log("[BulkReview] bioResp response", id, resp);
      if (!resp.success || !resp.data) return null;
      return resp.data as { artist_id: string; proposals: BioProposalLike[] };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[BulkReview] bioResp threw", err);
      return null;
    }
  });

  // refetch bios whenever a source flips terminal (same trigger as taxons).
  createEffect(
    on(proposalReloadKey, (k, prev) => {
      if (prev !== undefined && k !== prev) setBioReloadKey((x) => x + 1);
    })
  );

  const [selectedBioSource, setSelectedBioSource] = createSignal<BioSourceLike | null>(null);
  const [customBioText, setCustomBioText] = createSignal("");
  // reset bio selection on album change.
  createEffect(
    on(albumId, () => {
      setSelectedBioSource(null);
      setCustomBioText("");
    })
  );
  // when proposals load, default-select a proposal so the textarea
  // seeds and a no-op save&next does the right thing. preference order:
  //   1. whichever proposal is `is_current` (already persisted)
  //   2. otherwise the first proposal in the list (server orders
  //      user > lastfm > audiodb).
  createEffect(
    on(bioResp, (r) => {
      if (!r) return;
      if (selectedBioSource() !== null) return;
      const pick = r.proposals.find((p) => p.is_current) ?? r.proposals[0];
      if (pick) {
        setSelectedBioSource(pick.source);
        setCustomBioText(pick.text);
      }
    })
  );

  const onPickBio = (source: BioSourceLike, text: string) => {
    // toggle off when clicking the already-selected source so the user
    // can opt out of writing a bio entirely.
    if (selectedBioSource() === source) {
      setSelectedBioSource(null);
      setCustomBioText("");
      return;
    }
    setSelectedBioSource(source);
    setCustomBioText(text);
  };

  // returns true if the user's pick differs from whichever proposal is
  // currently flagged `is_current` (i.e. there's something to write).
  const bioNeedsApply = (): boolean => {
    const r = bioResp();
    if (!r) return false;
    if (selectedBioSource() === null) return false;
    const text = customBioText().trim();
    if (text.length === 0) return false;
    const cur = r.proposals.find((p) => p.is_current);
    if (cur && cur.text.trim() === text) return false;
    return true;
  };

  // ---- related artists (slice 4c) ----
  // refetched on the same triggers as bios + taxons (album change,
  // source flip-to-terminal). uses album_id and lets the server
  // resolve to an artist_id.
  const [relatedReloadKey, setRelatedReloadKey] = createSignal(0);
  const relatedKey = createMemo<[string | null, number] | null>(() => {
    const id = albumId();
    if (!id) return null;
    return [id, relatedReloadKey()];
  });
  const [relatedResp] = createResource(relatedKey, async (k) => {
    // eslint-disable-next-line no-console
    console.log("[BulkReview] relatedResp fetcher fired", k);
    if (!k) return null;
    const [id] = k;
    if (!id) return null;
    try {
      const client = await getClientForRemote(props.remote);
      const resp = await client.music.proposeRelatedArtists({ album_id: id });
      // eslint-disable-next-line no-console
      console.log("[BulkReview] relatedResp response", id, resp);
      if (!resp.success || !resp.data) return null;
      return resp.data as { artist_id: string; proposals: RelatedArtistProposalLike[] };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[BulkReview] relatedResp threw", err);
      return null;
    }
  });
  createEffect(
    on(proposalReloadKey, (k, prev) => {
      if (prev !== undefined && k !== prev) setRelatedReloadKey((x) => x + 1);
    })
  );

  const [acceptRelatedIds, setAcceptRelatedIds] = createSignal<Set<string>>(new Set<string>());
  const [rejectRelatedIds, setRejectRelatedIds] = createSignal<Set<string>>(new Set<string>());
  // track which album we already auto-accepted for so we don't clobber
  // user edits on subsequent fetcher refetches.
  const [autoAcceptedFor, setAutoAcceptedFor] = createSignal<string | null>(null);
  // reset on album change.
  createEffect(
    on(albumId, () => {
      setAcceptRelatedIds(new Set<string>());
      setRejectRelatedIds(new Set<string>());
      setAutoAcceptedFor(null);
    })
  );
  // default-accept only the related-artist proposals that are already
  // matched to a local artist (`related_artist_id` non-null). external
  // / unmatched candidates start unchecked so the user explicitly
  // opts in (linking a brand-new artist is a heavier decision).
  createEffect(() => {
    if (relatedResp.loading) return;
    const r = relatedResp();
    if (!r) return;
    const id = albumId();
    if (!id) return;
    if (autoAcceptedFor() === id) return;
    const inLibrary = r.proposals
      .filter((p) => !!(p as { related_artist_id?: string | null }).related_artist_id)
      .map((p) => p.id);
    setAcceptRelatedIds(new Set<string>(inLibrary));
    setAutoAcceptedFor(id);
  });

  const toggleAcceptRelated = (id: string) => {
    setAcceptRelatedIds((prev) => {
      const next = new Set<string>(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // accept clears any reject mark on the same row.
    setRejectRelatedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set<string>(prev);
      next.delete(id);
      return next;
    });
  };
  const toggleRejectRelated = (id: string) => {
    setRejectRelatedIds((prev) => {
      const next = new Set<string>(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAcceptRelatedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set<string>(prev);
      next.delete(id);
      return next;
    });
  };
  const acceptAllRelated = () => {
    const r = relatedResp();
    if (!r) return;
    setAcceptRelatedIds(new Set<string>(r.proposals.map((p) => p.id)));
    setRejectRelatedIds(new Set<string>());
  };
  const clearRelated = () => {
    setAcceptRelatedIds(new Set<string>());
    setRejectRelatedIds(new Set<string>());
  };
  const relatedNeedsApply = (): boolean =>
    acceptRelatedIds().size > 0 || rejectRelatedIds().size > 0;

  // ---- external urls (phase 11.x) ----
  // surface external links harvested from already-stored snapshots
  // (mb url-rels, last.fm pages, audiodb website/facebook/twitter).
  // defaults to all-checked per user request: ingest is the common
  // case, opt-out is one click. only proposes urls not already in
  // entity_urlz so re-runs converge cleanly.
  const [externalUrlsReloadKey, setExternalUrlsReloadKey] = createSignal(0);
  const externalUrlsKey = createMemo<[string | null, number] | null>(() => {
    const id = albumId();
    if (!id) return null;
    return [id, externalUrlsReloadKey()];
  });
  const [externalUrlsResp] = createResource(externalUrlsKey, async (k) => {
    if (!k) return null;
    const [id] = k;
    if (!id) return null;
    try {
      const client = await getClientForRemote(props.remote);
      const resp = await client.music.proposeExternalUrls({ album_id: id });
      if (!resp.success || !resp.data) return null;
      return resp.data as {
        album_id: string;
        artist_id?: string | null;
        proposals: ExternalUrlProposalLike[];
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[BulkReview] externalUrlsResp threw", err);
      return null;
    }
  });
  createEffect(
    on(proposalReloadKey, (k, prev) => {
      if (prev !== undefined && k !== prev) setExternalUrlsReloadKey((x) => x + 1);
    })
  );

  const [acceptExternalUrlKeys, setAcceptExternalUrlKeys] = createSignal<Set<string>>(
    new Set<string>()
  );
  const [externalUrlsAutoFor, setExternalUrlsAutoFor] = createSignal<string | null>(null);
  createEffect(
    on(albumId, () => {
      setAcceptExternalUrlKeys(new Set<string>());
      setExternalUrlsAutoFor(null);
    })
  );
  // default-check every proposal on first arrival for a given album.
  // user can toggle individual rows off before save.
  createEffect(() => {
    if (externalUrlsResp.loading) return;
    const r = externalUrlsResp();
    if (!r) return;
    const id = albumId();
    if (!id) return;
    if (externalUrlsAutoFor() === id) return;
    setAcceptExternalUrlKeys(new Set<string>(r.proposals.map((p) => externalUrlKey(p))));
    setExternalUrlsAutoFor(id);
  });

  const toggleExternalUrl = (p: ExternalUrlProposalLike) => {
    const k = externalUrlKey(p);
    setAcceptExternalUrlKeys((prev) => {
      const next = new Set<string>(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const acceptAllExternalUrls = () => {
    const r = externalUrlsResp();
    if (!r) return;
    setAcceptExternalUrlKeys(new Set<string>(r.proposals.map((p) => externalUrlKey(p))));
  };
  const clearExternalUrls = () => {
    setAcceptExternalUrlKeys(new Set<string>());
  };
  const externalUrlsNeedsApply = (): boolean => acceptExternalUrlKeys().size > 0;

  // ---- album image candidates (slice 3) ----
  // surface remote image urls from stored audiodb / mb metadata so
  // the user can one-click ingest the right cover. read-only on the
  // server; ingest happens per-tile via existing ingestRemoteImage.
  const [imageReloadKey, setImageReloadKey] = createSignal(0);
  const imageKey = createMemo<[string | null, number] | null>(() => {
    const id = albumId();
    if (!id) return null;
    return [id, imageReloadKey()];
  });
  const [albumImagesResp, { refetch: _refetchAlbumImages }] = createResource(
    imageKey,
    async (k) => {
      // eslint-disable-next-line no-console
      console.log("[BulkReview] albumImagesResp fetcher fired", k);
      if (!k) return null;
      const [id] = k;
      if (!id) return null;
      try {
        const client = await getClientForRemote(props.remote);
        const resp = await client.music.albumImageCandidates({ album_id: id });
        // eslint-disable-next-line no-console
        console.log("[BulkReview] albumImagesResp response", id, resp);
        if (!resp.success || !resp.data) return null;
        return resp.data as {
          album_id: string;
          candidates: ImageCandidateLike[];
          ingested_blob_ids: string[];
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[BulkReview] albumImagesResp threw", err);
        return null;
      }
    }
  );
  // refetch when proposal sources flip-to-terminal (mirrors bio /
  // related — newly arrived audiodb data may add cover urls).
  createEffect(
    on(proposalReloadKey, (k, prev) => {
      if (prev !== undefined && k !== prev) setImageReloadKey((x) => x + 1);
    })
  );
  const [selectedAlbumImageUrls, setSelectedAlbumImageUrls] = createSignal<Set<string>>(
    new Set<string>()
  );
  // reset per-album so prior selections don't bleed across.
  createEffect(
    on(albumId, () => {
      setSelectedAlbumImageUrls(new Set<string>());
    })
  );
  const onToggleAlbumImage = (c: ImageCandidateLike) => {
    setSelectedAlbumImageUrls((prev) => {
      const next = new Set<string>(prev);
      if (next.has(c.url)) next.delete(c.url);
      else next.add(c.url);
      return next;
    });
  };

  // ---- artist image candidates (slice 4b) ----
  // mirror of album images but resolved through album_id -> artist.
  const [artistImgReloadKey, setArtistImgReloadKey] = createSignal(0);
  const artistImgKey = createMemo<[string | null, number] | null>(() => {
    const id = albumId();
    if (!id) return null;
    return [id, artistImgReloadKey()];
  });
  const [artistImagesResp, { refetch: _refetchArtistImages }] = createResource(
    artistImgKey,
    async (k) => {
      // eslint-disable-next-line no-console
      console.log("[BulkReview] artistImagesResp fetcher fired", k);
      if (!k) return null;
      const [id] = k;
      if (!id) return null;
      try {
        const client = await getClientForRemote(props.remote);
        const resp = await client.music.artistImageCandidates({ album_id: id });
        // eslint-disable-next-line no-console
        console.log("[BulkReview] artistImagesResp response", id, resp);
        if (!resp.success || !resp.data) return null;
        return resp.data as {
          artist_id: string;
          candidates: ImageCandidateLike[];
          ingested_blob_ids: string[];
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[BulkReview] artistImagesResp threw", err);
        return null;
      }
    }
  );
  createEffect(
    on(proposalReloadKey, (k, prev) => {
      if (prev !== undefined && k !== prev) setArtistImgReloadKey((x) => x + 1);
    })
  );
  const [selectedArtistImageUrls, setSelectedArtistImageUrls] = createSignal<Set<string>>(
    new Set<string>()
  );
  createEffect(
    on(albumId, () => {
      setSelectedArtistImageUrls(new Set<string>());
    })
  );
  // when artist images load, default-select the first candidate so the
  // user only has to hit save to ingest a sensible default.
  createEffect(
    on(artistImagesResp, (r) => {
      if (!r) return;
      if (selectedArtistImageUrls().size > 0) return;
      const first = r.candidates[0];
      if (!first) return;
      setSelectedArtistImageUrls(new Set<string>([first.url]));
    })
  );
  const onToggleArtistImage = (c: ImageCandidateLike) => {
    setSelectedArtistImageUrls((prev) => {
      const next = new Set<string>(prev);
      if (next.has(c.url)) next.delete(c.url);
      else next.add(c.url);
      return next;
    });
  };

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
      if (bioNeedsApply()) {
        const r = bioResp()!;
        const src = selectedBioSource()!;
        const bioApply = await client.music.applyArtistBio({
          artist_id: r.artist_id,
          source: src,
          text: customBioText(),
        });
        if (!bioApply.success) {
          toast.error(bioApply.error.message || "failed to apply bio");
          return;
        }
      }
      // apply related-artist accept / reject decisions.
      if (relatedNeedsApply()) {
        const r = relatedResp();
        if (r) {
          const relApply = await client.music.applyRelatedArtists({
            artist_id: r.artist_id,
            accept_ids: [...acceptRelatedIds()],
            reject_ids: [...rejectRelatedIds()],
          });
          if (!relApply.success) {
            toast.error(relApply.error.message || "failed to apply related artists");
            return;
          }
        }
      }
      // apply external-url ingestions (mb url-rels, lf, audiodb).
      if (externalUrlsNeedsApply()) {
        const r = externalUrlsResp();
        if (r) {
          const accepted = r.proposals
            .filter((p) => acceptExternalUrlKeys().has(externalUrlKey(p)))
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
      const albumPicked = [...selectedAlbumImageUrls()];
      const albumPanel = albumImagesResp();
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
      const artistPicked = [...selectedArtistImageUrls()];
      const artistPanel = artistImagesResp();
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
      const statusResp = await client.music.setAlbumReviewStatus({
        album_id: id,
        status: "complete",
      });
      if (!statusResp.success) {
        toast.error(statusResp.error.message || "failed to mark album complete");
        return;
      }
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

  const skipAndAdvance = () => {
    if (busy()) return;
    if (hasNext()) props.onNext();
    else props.onExit();
  };

  const dismissAndAdvance = async () => {
    const id = albumId();
    if (!id) return;
    if (busy()) return;
    setBusy(true);
    try {
      const client = await getClientForRemote(props.remote);
      const resp = await client.music.setAlbumReviewStatus({
        album_id: id,
        status: "dismissed",
      });
      if (!resp.success) {
        toast.error(resp.error.message || "failed to dismiss album");
        return;
      }
      if (hasNext()) props.onNext();
      else props.onExit();
    } catch (err) {
      toast.error(`dismiss failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

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
          <ProgressBadges progress={progress()} />
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
            <Show when={acceptedCount() > 0}>
              <span>{acceptedCount()} selected</span>
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
              onClick={() => void dismissAndAdvance()}
              disabled={busy()}
              class="px-3 py-1.5 rounded text-xs border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] cursor-pointer disabled:opacity-50"
              title="hide this album from future bulk reviews"
            >
              dismiss
            </button>
            <button
              type="button"
              onClick={() => props.onMinimize()}
              disabled={busy()}
              class="px-3 py-1.5 rounded text-xs border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] cursor-pointer disabled:opacity-50"
              title="close the modal but keep the bulk session running"
            >
              minimize
            </button>
            <button
              type="button"
              onClick={() => props.onExit()}
              disabled={busy()}
              class="px-3 py-1.5 rounded text-xs border border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-hover)] cursor-pointer disabled:opacity-50"
            >
              exit
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
            bioState: bioResp.state,
            bioProposalsLen: bioResp()?.proposals.length,
            relatedState: relatedResp.state,
            relatedProposalsLen: relatedResp()?.proposals.length,
            albumImagesState: albumImagesResp.state,
            albumCandidatesLen: albumImagesResp()?.candidates.length,
            artistImagesState: artistImagesResp.state,
            artistCandidatesLen: artistImagesResp()?.candidates.length,
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
              songs={songs() ?? []}
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
        <Show when={(bioResp()?.proposals.length ?? 0) > 0}>
          <ArtistBioReviewPanel
            artistName={null}
            proposals={bioResp()?.proposals ?? []}
            selectedSource={selectedBioSource()}
            customText={customBioText()}
            onSelect={onPickBio}
            onCustomChange={setCustomBioText}
          />
        </Show>
        <Show when={relatedResp() !== undefined}>
          <RelatedArtistsReviewPanel
            proposals={relatedResp()?.proposals ?? []}
            acceptIds={acceptRelatedIds()}
            rejectIds={rejectRelatedIds()}
            onToggleAccept={toggleAcceptRelated}
            onToggleReject={toggleRejectRelated}
            onAcceptAll={acceptAllRelated}
            onClear={clearRelated}
          />
        </Show>
        <Show when={externalUrlsResp() !== undefined}>
          <ExternalUrlsReviewPanel
            proposals={externalUrlsResp()?.proposals ?? []}
            acceptKeys={acceptExternalUrlKeys()}
            onToggle={toggleExternalUrl}
            onAcceptAll={acceptAllExternalUrls}
            onClear={clearExternalUrls}
          />
        </Show>
        <Show when={albumImagesResp() !== undefined}>
          <ImagePickGrid
            title="album images"
            candidates={albumImagesResp()?.candidates ?? []}
            ingestedCount={albumImagesResp()?.ingested_blob_ids.length ?? 0}
            selected={selectedAlbumImageUrls()}
            onToggle={onToggleAlbumImage}
          />
        </Show>
        <Show when={artistImagesResp() !== undefined}>
          <ImagePickGrid
            title="artist images"
            candidates={artistImagesResp()?.candidates ?? []}
            ingestedCount={artistImagesResp()?.ingested_blob_ids.length ?? 0}
            selected={selectedArtistImageUrls()}
            onToggle={onToggleArtistImage}
          />
        </Show>
        <Show when={refetchProposals as unknown}>
          <></>
        </Show>
      </div>
    </Modal>
  );
}

function ProgressBadges(props: {
  progress: Array<{ source: string; status: string; last_error?: string | null }>;
}) {
  return (
    <div class="flex items-center gap-1.5">
      <For each={props.progress}>
        {(p) => (
          <span
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide"
            classList={{
              "bg-[var(--color-error-500)]/15 text-[var(--color-error-500)]":
                isFailed(p.status) || !!p.last_error,
              "bg-[var(--color-success-500)]/15 text-[var(--color-success-500)]":
                isTerminalDone(p.status) && !p.last_error,
              "bg-[var(--color-warning-500)]/15 text-[var(--color-warning-500)]": isInflight(
                p.status
              ),
              "bg-[var(--color-bg-elevated)] text-[var(--color-text-disabled)]":
                !isTerminalDone(p.status) &&
                !isInflight(p.status) &&
                !isFailed(p.status) &&
                !p.last_error,
            }}
            title={
              p.last_error
                ? `${p.source}: ${p.status}\n${p.last_error}`
                : `${p.source}: ${p.status}`
            }
          >
            {sourceShort(p.source)}
            <span class="opacity-70">{statusGlyph(p.status, !!p.last_error)}</span>
          </span>
        )}
      </For>
    </div>
  );
}

// inline expandable error list — surfaces backend failure messages so
// the user can see *why* a source returned no candidates (e.g. mb api
// rate-limit, network error, mismatched artist/title).
function ProgressErrorList(props: {
  progress: Array<{ source: string; status: string; last_error?: string | null }>;
}) {
  const errors = () => props.progress.filter((p) => p.last_error || isFailed(p.status));
  return (
    <Show when={errors().length > 0}>
      <details class="text-[10px] text-[var(--color-error-500)] mt-0.5">
        <summary class="cursor-pointer">
          {errors().length} enrichment error{errors().length === 1 ? "" : "s"} — click to show
        </summary>
        <ul class="mt-1 pl-3 flex flex-col gap-0.5">
          <For each={errors()}>
            {(p) => (
              <li>
                <span class="font-medium">{sourceShort(p.source)}</span>: 
                <span class="opacity-90 break-all">{p.last_error || p.status}</span>
              </li>
            )}
          </For>
        </ul>
      </details>
    </Show>
  );
}

function sourceShort(s: string): string {
  switch (s) {
    case "mb":
      return "mb";
    case "lastfm":
      return "lf";
    case "audiodb":
      return "ad";
    default:
      return s.toLowerCase();
  }
}

function isTerminalDone(status: string): boolean {
  const s = status.toLowerCase();
  return (
    s === "completed" || s === "enriched" || s === "no_match" || s === "done" || s === "complete"
  );
}

function isInflight(status: string): boolean {
  const s = status.toLowerCase();
  return (
    s === "running" ||
    s === "queued" ||
    s === "pending" ||
    s === "searching" ||
    s === "fetching_detail"
  );
}

function isFailed(status: string): boolean {
  const s = status.toLowerCase();
  return s === "failed" || s === "error" || s.includes("error");
}

function statusGlyph(status: string, hasError = false): string {
  if (hasError || isFailed(status)) return "!";
  if (isTerminalDone(status)) return "✓";
  if (isInflight(status)) return "…";
  return "·";
}

function pickSource(sources: string[]): "mb" | "lastfm" | "audiodb" {
  // priority order: musicbrainz > lastfm > audiodb. matches the
  // `ProposalSource` enum on the server side; the wire serialization
  // uses snake_case variants ("mb" / "lastfm" / "audiodb").
  if (sources.includes("mb")) return "mb";
  if (sources.includes("lastfm")) return "lastfm";
  if (sources.includes("audiodb")) return "audiodb";
  return "mb";
}
