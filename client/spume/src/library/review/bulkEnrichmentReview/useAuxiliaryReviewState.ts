import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  type Accessor,
  type Resource,
} from "solid-js";
import { getClientForRemote } from "../../../app/api/client";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import type { BioProposalLike, BioSourceLike } from "../ArtistBioReviewPanel";
import type { RelatedArtistProposalLike } from "../RelatedArtistsReviewPanel";
import {
  externalUrlKey,
  type ExternalUrlProposalLike,
} from "../ExternalUrlsReviewPanel";
import type { ImageCandidateLike } from "../ImagePickGrid";

export interface BioState {
  artist_id: string;
  proposals: BioProposalLike[];
}

export interface RelatedState {
  artist_id: string;
  proposals: RelatedArtistProposalLike[];
}

export interface ExternalUrlsState {
  album_id: string;
  artist_id?: string | null;
  proposals: ExternalUrlProposalLike[];
}

export interface AlbumImagesState {
  album_id: string;
  candidates: ImageCandidateLike[];
  ingested_blob_ids: string[];
}

export interface ArtistImagesState {
  artist_id: string;
  candidates: ImageCandidateLike[];
  ingested_blob_ids: string[];
}

export interface AuxiliaryReviewState {
  // bio
  bioResp: Resource<BioState | null>;
  selectedBioSource: Accessor<BioSourceLike | null>;
  customBioText: Accessor<string>;
  setCustomBioText: (s: string) => void;
  onPickBio: (source: BioSourceLike, text: string) => void;
  bioNeedsApply: () => boolean;
  // related artists
  relatedResp: Resource<RelatedState | null>;
  acceptRelatedIds: Accessor<Set<string>>;
  rejectRelatedIds: Accessor<Set<string>>;
  toggleAcceptRelated: (id: string) => void;
  toggleRejectRelated: (id: string) => void;
  acceptAllRelated: () => void;
  clearRelated: () => void;
  relatedNeedsApply: () => boolean;
  // external urls
  externalUrlsResp: Resource<ExternalUrlsState | null>;
  acceptExternalUrlKeys: Accessor<Set<string>>;
  toggleExternalUrl: (p: ExternalUrlProposalLike) => void;
  acceptAllExternalUrls: () => void;
  clearExternalUrls: () => void;
  externalUrlsNeedsApply: () => boolean;
  // album images
  albumImagesResp: Resource<AlbumImagesState | null>;
  selectedAlbumImageUrls: Accessor<Set<string>>;
  onToggleAlbumImage: (c: ImageCandidateLike) => void;
  // artist images
  artistImagesResp: Resource<ArtistImagesState | null>;
  selectedArtistImageUrls: Accessor<Set<string>>;
  onToggleArtistImage: (c: ImageCandidateLike) => void;
}

export function useAuxiliaryReviewState(opts: {
  albumId: Accessor<string | null>;
  proposalReloadKey: Accessor<number>;
  remote: Remote;
}): AuxiliaryReviewState {
  const { albumId, proposalReloadKey, remote } = opts;

  // ---- artist bio ----
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
      const client = await getClientForRemote(remote);
      const resp = await client.music.proposeArtistBios({ album_id: id });
      // eslint-disable-next-line no-console
      console.log("[BulkReview] bioResp response", id, resp);
      if (!resp.success || !resp.data) return null;
      return resp.data as BioState;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[BulkReview] bioResp threw", err);
      return null;
    }
  });

  createEffect(
    on(proposalReloadKey, (k, prev) => {
      if (prev !== undefined && k !== prev) setBioReloadKey((x) => x + 1);
    })
  );

  const [selectedBioSource, setSelectedBioSource] = createSignal<BioSourceLike | null>(null);
  const [customBioText, setCustomBioText] = createSignal("");
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

  // ---- related artists ----
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
      const client = await getClientForRemote(remote);
      const resp = await client.music.proposeRelatedArtists({ album_id: id });
      // eslint-disable-next-line no-console
      console.log("[BulkReview] relatedResp response", id, resp);
      if (!resp.success || !resp.data) return null;
      return resp.data as RelatedState;
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
  const [autoAcceptedFor, setAutoAcceptedFor] = createSignal<string | null>(null);
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

  // ---- external urls ----
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
      const client = await getClientForRemote(remote);
      const resp = await client.music.proposeExternalUrls({ album_id: id });
      if (!resp.success || !resp.data) return null;
      return resp.data as ExternalUrlsState;
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

  // ---- album image candidates ----
  const [imageReloadKey, setImageReloadKey] = createSignal(0);
  const imageKey = createMemo<[string | null, number] | null>(() => {
    const id = albumId();
    if (!id) return null;
    return [id, imageReloadKey()];
  });
  const [albumImagesResp] = createResource(imageKey, async (k) => {
    // eslint-disable-next-line no-console
    console.log("[BulkReview] albumImagesResp fetcher fired", k);
    if (!k) return null;
    const [id] = k;
    if (!id) return null;
    try {
      const client = await getClientForRemote(remote);
      const resp = await client.music.imageCandidatesForAlbum({ album_id: id });
      // eslint-disable-next-line no-console
      console.log("[BulkReview] albumImagesResp response", id, resp);
      if (!resp.success || !resp.data) return null;
      return resp.data as AlbumImagesState;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[BulkReview] albumImagesResp threw", err);
      return null;
    }
  });
  createEffect(
    on(proposalReloadKey, (k, prev) => {
      if (prev !== undefined && k !== prev) setImageReloadKey((x) => x + 1);
    })
  );
  const [selectedAlbumImageUrls, setSelectedAlbumImageUrls] = createSignal<Set<string>>(
    new Set<string>()
  );
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

  // ---- artist image candidates ----
  const [artistImgReloadKey, setArtistImgReloadKey] = createSignal(0);
  const artistImgKey = createMemo<[string | null, number] | null>(() => {
    const id = albumId();
    if (!id) return null;
    return [id, artistImgReloadKey()];
  });
  const [artistImagesResp] = createResource(artistImgKey, async (k) => {
    // eslint-disable-next-line no-console
    console.log("[BulkReview] artistImagesResp fetcher fired", k);
    if (!k) return null;
    const [id] = k;
    if (!id) return null;
    try {
      const client = await getClientForRemote(remote);
      const resp = await client.music.imageCandidatesForArtist({ album_id: id });
      // eslint-disable-next-line no-console
      console.log("[BulkReview] artistImagesResp response", id, resp);
      if (!resp.success || !resp.data) return null;
      return resp.data as ArtistImagesState;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[BulkReview] artistImagesResp threw", err);
      return null;
    }
  });
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
  // default-select the first candidate when artist images arrive so
  // the user only has to hit save to ingest a sensible default.
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

  return {
    bioResp,
    selectedBioSource,
    customBioText,
    setCustomBioText,
    onPickBio,
    bioNeedsApply,
    relatedResp,
    acceptRelatedIds,
    rejectRelatedIds,
    toggleAcceptRelated,
    toggleRejectRelated,
    acceptAllRelated,
    clearRelated,
    relatedNeedsApply,
    externalUrlsResp,
    acceptExternalUrlKeys,
    toggleExternalUrl,
    acceptAllExternalUrls,
    clearExternalUrls,
    externalUrlsNeedsApply,
    albumImagesResp,
    selectedAlbumImageUrls,
    onToggleAlbumImage,
    artistImagesResp,
    selectedArtistImageUrls,
    onToggleArtistImage,
  };
}
