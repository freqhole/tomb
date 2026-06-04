// musicbrainz integration panel for album editor
// search musicbrainz releases, browse results, import cover art + metadata
import { createMemo, createSignal, For, Show } from "solid-js";
import type { Song } from "../../music/services/storage/types";
import { getDataSource, getCurrentRemote } from "../../music/data";
import type { MbArtistCredit, MbReleaseListItem, MbReleaseDetail } from "../../music/data/types";
import { getClientForRemote } from "../../app/api/client";
import { TextInput } from "../forms/TextInput";
import { Button } from "../buttons/Button";
import { Icon, IconNames } from "../icons/registry";
import { toast } from "../feedback/Toast";
import { formatLongDuration } from "../../utils/formatDuration";
import { error as errorLog } from "../../utils/logger";
import { MusicBrainzAlbumImages, type AlbumArtImage } from "./MusicBrainzAlbumImages";
import { MusicBrainzTrackComparison } from "./MusicBrainzTrackComparison";
import { MarqueeText } from "../text/MarqueeText";

// page size for search results
const PAGE_SIZE = 100;

export interface MusicBrainzPanelProps {
  /** freqhole album id */
  albumId: string;
  /** current album title for pre-filling search */
  albumTitle: string;
  /** current artist id */
  artistId: string;
  /** current artist name for pre-filling search */
  artistName: string;
  /** current album type */
  albumType: string;
  /** current release date */
  releaseDate?: string;
  /** current label */
  label?: string;
  /** current genre names */
  genres?: string[];
  /** songs in this album */
  songs: Song[];
  /** called after any metadata or image import so parent can refetch */
  onAlbumUpdated: () => void;
}

// re-export types for local use
type ReleaseListItem = MbReleaseListItem;
type ReleaseDetail = MbReleaseDetail;
type ArtistCreditEntry = MbArtistCredit;

export function MusicBrainzPanel(props: MusicBrainzPanelProps) {
  const [searchRelease, setSearchRelease] = createSignal(props.albumTitle || "");
  const [searchArtist, setSearchArtist] = createSignal(props.artistName || "");
  const [searching, setSearching] = createSignal(false);
  const [hasSearched, setHasSearched] = createSignal(false);
  const [results, setResults] = createSignal<ReleaseListItem[]>([]);
  const [searchCount, setSearchCount] = createSignal(0);
  const [currentOffset, setCurrentOffset] = createSignal(0);
  const [countryFilter, setCountryFilter] = createSignal<string>("");
  const [selectedRelease, setSelectedRelease] = createSignal<ReleaseDetail | null>(null);
  const [selectedListItem, setSelectedListItem] = createSignal<ReleaseListItem | null>(null);
  const [loadingRelease, setLoadingRelease] = createSignal(false);

  // image import state — track per-image progress
  const [importingImages, setImportingImages] = createSignal<Set<string>>(new Set());
  const [importedImages, setImportedImages] = createSignal<Set<string>>(new Set());

  // metadata import state
  const [importingAlbum, setImportingAlbum] = createSignal(false);

  // ── helpers ──

  const formatArtistCredit = (credits?: ArtistCreditEntry[]): string => {
    if (!credits || credits.length === 0) return "unknown artist";
    return credits.map((c) => c.name + (c.joinphrase || "")).join("");
  };

  const getTotalDurationMs = (detail: ReleaseDetail): number => {
    let total = 0;
    for (const medium of detail.media) {
      for (const track of medium.tracks) {
        total += track.length_ms || 0;
      }
    }
    return total;
  };

  type CoverArtImage = ReleaseDetail["cover_art_images"][number];

  const getCoverArtThumbUrl = (image: CoverArtImage): string => {
    return (
      image.thumbnails?.thumb_500 ||
      image.thumbnails?.thumb_250 ||
      image.thumbnails?.small ||
      image.image_url
    );
  };

  const getCoverArtFullUrl = (image: CoverArtImage): string => {
    return image.thumbnails?.thumb_1200 || image.thumbnails?.large || image.image_url;
  };

  const uniqueCountries = () => {
    const countries = new Set<string>();
    for (const r of results()) {
      if (r.country) countries.add(r.country);
    }
    return [...countries].sort();
  };

  const filteredResults = createMemo(() => {
    const filter = countryFilter();
    let list: ReleaseListItem[];
    if (!filter) list = results();
    else if (filter === "__none__") list = results().filter((r) => !r.country);
    else list = results().filter((r) => r.country === filter);

    // re-sort: boost releases with 100% score AND matching track count to the top
    const localTrackCount = props.songs.length;
    return [...list].sort((a, b) => {
      const aMatch = a.score === 100 && a.track_count === localTrackCount ? 1 : 0;
      const bMatch = b.score === 100 && b.track_count === localTrackCount ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      return (b.score ?? 0) - (a.score ?? 0);
    });
  });

  const currentPage = () => Math.floor(currentOffset() / PAGE_SIZE) + 1;
  const totalPages = () => Math.ceil(searchCount() / PAGE_SIZE);
  const hasPrev = () => currentOffset() > 0;
  const hasNext = () => currentOffset() + PAGE_SIZE < searchCount();

  // ── search ──

  const doSearch = async (offset: number) => {
    const release = searchRelease().trim();
    const artist = searchArtist().trim();

    if (!release && !artist) {
      toast.info("enter a release title or artist name");
      return;
    }

    const dataSource = getDataSource();
    if (!dataSource.searchMusicbrainzReleases) {
      toast.error("musicbrainz search not available");
      return;
    }

    setSearching(true);
    setHasSearched(true);
    if (offset === 0) {
      setSelectedRelease(null);
      setSelectedListItem(null);
      setCountryFilter("");
      setImportedImages(new Set<string>());
    }

    const params = {
      artist: artist || null,
      release: release || null,
      limit: PAGE_SIZE,
      offset: offset || null,
    };

    try {
      const result = await dataSource.searchMusicbrainzReleases(params);

      if (result) {
        setResults(result.results || []);
        setSearchCount(result.count || 0);
        setCurrentOffset(offset);
      } else {
        errorLog("musicbrainz search failed");
        toast.error("musicbrainz search failed");
        setResults([]);
      }
    } catch (err) {
      errorLog("musicbrainz search error:", err);
      toast.error("failed to search musicbrainz");
    } finally {
      setSearching(false);
    }
  };

  const handleSearch = () => doSearch(0);
  const handlePrevPage = () => doSearch(Math.max(0, currentOffset() - PAGE_SIZE));
  const handleNextPage = () => doSearch(currentOffset() + PAGE_SIZE);

  const handleSelectRelease = async (release: ReleaseListItem) => {
    const dataSource = getDataSource();
    if (!dataSource.getMusicbrainzRelease) {
      toast.error("musicbrainz not available");
      return;
    }

    setSelectedListItem(release);
    setSelectedRelease(null);
    setLoadingRelease(true);
    setImportedImages(new Set<string>());

    try {
      const result = await dataSource.getMusicbrainzRelease(release.id);

      if (result) {
        setSelectedRelease(result);
      } else {
        errorLog("failed to fetch release details");
        toast.error("failed to fetch release details");
      }
    } catch (err) {
      errorLog("failed to fetch release details:", err);
      toast.error("failed to fetch release details");
    } finally {
      setLoadingRelease(false);
    }
  };

  // ── image import (self-contained) ──

  const handleImportImage = async (imageUrl: string) => {
    const remote = getCurrentRemote();
    if (!remote) {
      toast.error("no remote selected");
      return;
    }
    const fullUrl = imageUrl;
    setImportingImages((prev) => {
      const next = new Set(prev);
      next.add(fullUrl);
      return next;
    });

    try {
      const client = await getClientForRemote(remote);
      const resp = await client.music.ingestRemoteImage({
        remote_url: fullUrl,
        target: { kind: "Album", id: props.albumId },
        is_primary: false,
        source: "musicbrainz",
      });
      if (!resp.success) {
        toast.error(resp.error.message || "failed to import image");
        return;
      }

      // mark as imported
      setImportedImages((prev) => {
        const next = new Set(prev);
        next.add(fullUrl);
        return next;
      });
      props.onAlbumUpdated();
    } catch (err) {
      errorLog("failed to import image:", err);
      toast.error("failed to import image");
    } finally {
      setImportingImages((prev) => {
        const next = new Set(prev);
        next.delete(fullUrl);
        return next;
      });
    }
  };

  // ── album metadata comparison ──

  /** map MB primary_type + secondary_types to our album_type enum */
  const mapMbAlbumType = (detail: ReleaseDetail): string | null => {
    const mbType = detail.primary_type?.toLowerCase() || "";
    if (
      mbType.includes("compilation") ||
      detail.secondary_types?.map((t) => t.toLowerCase()).includes("compilation")
    ) {
      return "compilation";
    }
    if (mbType === "single") return "single";
    if (mbType === "album" || mbType === "ep") return "album";
    return null;
  };

  interface MetadataField {
    key: string;
    label: string;
    currentValue: string;
    mbValue: string;
    differs: boolean;
    /** special handling flag for artist name (updates artist entity not album) */
    isArtistName?: boolean;
  }

  const albumMetadataFields = createMemo((): MetadataField[] => {
    const detail = selectedRelease();
    if (!detail) return [];

    const fields: MetadataField[] = [];

    // title
    const mbTitle = detail.title || "";
    const curTitle = props.albumTitle || "";
    fields.push({
      key: "title",
      label: "title",
      currentValue: curTitle,
      mbValue: mbTitle,
      differs: mbTitle.toLowerCase() !== curTitle.toLowerCase(),
    });

    // artist
    const mbArtist = formatArtistCredit(detail.artist_credit);
    const curArtist = props.artistName || "";
    if (mbArtist !== "unknown artist") {
      fields.push({
        key: "artist_name",
        label: "artist",
        currentValue: curArtist,
        mbValue: mbArtist,
        differs: mbArtist.toLowerCase() !== curArtist.toLowerCase(),
        isArtistName: true,
      });
    }

    // album type
    const mbAlbumType = mapMbAlbumType(detail);
    const curAlbumType = props.albumType || "";
    if (mbAlbumType) {
      fields.push({
        key: "album_type",
        label: "type",
        currentValue: curAlbumType,
        mbValue: mbAlbumType,
        differs: mbAlbumType !== curAlbumType,
      });
    }

    // release date
    const mbDate = detail.date || "";
    const curDate = props.releaseDate || "";
    fields.push({
      key: "release_date",
      label: "date",
      currentValue: curDate,
      mbValue: mbDate,
      differs: mbDate !== curDate,
    });

    // label
    const mbLabel = detail.label || "";
    const curLabel = props.label || "";
    if (mbLabel) {
      fields.push({
        key: "label",
        label: "label",
        currentValue: curLabel,
        mbValue: mbLabel,
        differs: mbLabel.toLowerCase() !== curLabel.toLowerCase(),
      });
    }

    // genres (compare sorted arrays so order doesn't affect diff)
    const mbGenreArr = (detail.genres || []).map((g) => g.toLowerCase()).sort();
    const curGenreArr = (props.genres || []).map((g) => g.toLowerCase()).sort();
    const mbGenres = (detail.genres || []).join(", ");
    const curGenres = (props.genres || []).join(", ");
    if (mbGenres) {
      const genresDiffer =
        mbGenreArr.length !== curGenreArr.length || mbGenreArr.some((g, i) => g !== curGenreArr[i]);
      fields.push({
        key: "genres",
        label: "genres",
        currentValue: curGenres,
        mbValue: mbGenres,
        differs: genresDiffer,
      });
    }

    return fields;
  });

  const changedFieldCount = createMemo(() => albumMetadataFields().filter((f) => f.differs).length);

  // ── album metadata import ──

  const [updatingField, setUpdatingField] = createSignal<string | null>(null);

  const syncAlbumGenresFromMusicBrainz = async (detail: ReleaseDetail) => {
    const remote = getCurrentRemote();
    if (!remote) {
      throw new Error("no remote selected");
    }

    const client = await getClientForRemote(remote);
    const linksResp = await client.music.getAlbumTaxonLinks({ album_id: props.albumId });
    if (!linksResp.success) {
      throw new Error("failed to load album taxons");
    }
    if (!linksResp.data) {
      throw new Error("failed to load album taxons");
    }

    const existingMbGenreLinks = linksResp.data.filter(
      (link) => link.kind_slug === "genre" && link.origin === "musicbrainz"
    );

    for (const link of existingMbGenreLinks) {
      const removeResp = await client.music.removeAlbumTaxon({
        album_id: props.albumId,
        taxon_id: link.taxon_id,
        origin: "musicbrainz",
      });
      if (!removeResp.success) {
        throw new Error(removeResp.error?.message || "failed to clear existing musicbrainz genres");
      }
    }

    const normalized = new Set(
      (detail.genres || []).map((g) => g.trim()).filter((g) => g.length > 0)
    );

    for (const label of normalized) {
      const taxonResp = await client.music.createTaxon({
        kind_slug: "genre",
        label,
        description: null,
        parent_ids: null,
      });
      if (!taxonResp.success) {
        throw new Error(`failed to resolve genre taxon: ${label}`);
      }
      if (!taxonResp.data) {
        throw new Error(`failed to resolve genre taxon: ${label}`);
      }

      const addResp = await client.music.addAlbumTaxon({
        album_id: props.albumId,
        taxon_id: taxonResp.data.id,
        origin: "musicbrainz",
        confidence: null,
      });
      if (!addResp.success) {
        throw new Error(addResp.error?.message || `failed to link genre: ${label}`);
      }
    }
  };

  const handleUpdateAlbumField = async (field: MetadataField) => {
    const dataSource = getDataSource();
    setUpdatingField(field.key);
    try {
      if (field.isArtistName) {
        if (!dataSource.updateArtist) {
          toast.error("artist update not available");
          return;
        }
        // update the artist entity name directly — no album re-scope
        await dataSource.updateArtist({
          artist_id: props.artistId,
          name: field.mbValue,
        });
        props.onAlbumUpdated();
      } else {
        if (!dataSource.updateAlbum) {
          toast.error("album update not available");
          return;
        }
        const detail = selectedRelease();
        if (!detail) {
          toast.error("release details not loaded");
          return;
        }

        if (field.key === "genres") {
          await syncAlbumGenresFromMusicBrainz(detail);
          props.onAlbumUpdated();
          return;
        }

        // update album field
        await dataSource.updateAlbum({
          album_id: props.albumId,
          title: field.key === "title" ? field.mbValue : null,
          artist_id: null,
          artist_name: null,
          album_type: field.key === "album_type" ? field.mbValue : null,
          release_date: field.key === "release_date" ? field.mbValue : null,
          label: field.key === "label" ? field.mbValue : null,
          entity_urls: null,
          updated_by: null,
        });
        props.onAlbumUpdated();
      }
    } catch (err) {
      errorLog(`failed to update ${field.label}:`, err);
      toast.error(`failed to update ${field.label}`);
    } finally {
      setUpdatingField(null);
    }
  };

  const handleImportAlbumMetadata = async () => {
    const detail = selectedRelease();
    if (!detail) return;

    const dataSource = getDataSource();

    const fields = albumMetadataFields().filter((f) => f.differs);
    if (fields.length === 0) {
      toast.info("no metadata changes to apply");
      return;
    }

    setImportingAlbum(true);
    try {
      // update artist name separately if it changed
      const artistField = fields.find((f) => f.isArtistName);
      if (artistField) {
        if (!dataSource.updateArtist) {
          toast.error("artist update not available");
          return;
        }
        await dataSource.updateArtist({
          artist_id: props.artistId,
          name: artistField.mbValue,
        });
      }

      // collect album-level changes
      const albumFields = fields.filter((f) => !f.isArtistName);
      if (albumFields.length > 0) {
        if (!dataSource.updateAlbum) {
          toast.error("album update not available");
          return;
        }
        const albumType = mapMbAlbumType(detail);
        await dataSource.updateAlbum({
          album_id: props.albumId,
          title: albumFields.some((f) => f.key === "title") ? detail.title || null : null,
          artist_id: null,
          artist_name: null,
          album_type: albumFields.some((f) => f.key === "album_type") ? albumType : null,
          release_date: albumFields.some((f) => f.key === "release_date")
            ? detail.date || null
            : null,
          label: albumFields.some((f) => f.key === "label") ? detail.label || null : null,
          entity_urls: null,
          updated_by: null,
        });
      }

      if (albumFields.some((f) => f.key === "genres")) {
        await syncAlbumGenresFromMusicBrainz(detail);
      }

      props.onAlbumUpdated();
    } catch (err) {
      errorLog("failed to import album metadata:", err);
      toast.error("failed to import album metadata");
    } finally {
      setImportingAlbum(false);
    }
  };

  // ── render ──

  return (
    <div class="space-y-4">
      {/* album info banner */}
      <div class="bg-[var(--color-bg-elevated)] p-3 rounded">
        <div class="text-sm text-[var(--color-text-secondary)]">
          {props.artistName} - {props.albumTitle}
        </div>
        <div class="text-xs text-[var(--color-text-tertiary)] mt-0.5 flex gap-3">
          <Show when={props.releaseDate}>
            <span>{props.releaseDate}</span>
          </Show>
          <span>{props.songs.length} tracks</span>
          <span>
            {formatLongDuration(props.songs.reduce((sum, s) => sum + (s.duration_seconds || 0), 0))}
          </span>
        </div>
      </div>

      {/* search form */}
      <div class="flex gap-2">
        <div class="flex-1">
          <label class="block text-xs text-[var(--color-text-tertiary)] mb-1">release</label>
          <TextInput
            value={searchRelease()}
            onInput={(e) => setSearchRelease(e.currentTarget.value)}
            placeholder="album or release title"
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
        </div>
        <div class="flex-1">
          <label class="block text-xs text-[var(--color-text-tertiary)] mb-1">artist</label>
          <TextInput
            value={searchArtist()}
            onInput={(e) => setSearchArtist(e.currentTarget.value)}
            placeholder="artist name"
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
        </div>
        <div class="flex items-end">
          <Button onClick={handleSearch} variant="secondary" disabled={searching()}>
            {searching() ? "..." : "search"}
          </Button>
        </div>
      </div>

      {/* selected release detail */}
      <Show when={selectedRelease() || selectedListItem()}>
        <div class="rounded-lg overflow-hidden">
          {/* release header */}
          <div class="bg-[var(--color-bg-elevated)] p-3">
            <div class="flex items-start justify-between">
              <div class="flex-1 min-w-0">
                <button
                  onClick={() => {
                    setSelectedRelease(null);
                    setSelectedListItem(null);
                    setImportedImages(new Set<string>());
                  }}
                  class="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] mb-1 flex items-center gap-1"
                >
                  <Icon name={IconNames.chevronLeft} size={12} /> back to results
                </button>
                {(() => {
                  const detail = selectedRelease();
                  const listItem = selectedListItem();
                  const title = detail?.title || listItem?.title || "";
                  const artistCredits = detail?.artist_credit || listItem?.artist_credit;
                  const date = detail?.date || listItem?.date;
                  const country = detail?.country || listItem?.country;
                  const status = detail?.status || listItem?.status;
                  const primaryType = detail?.primary_type || listItem?.primary_type;
                  const secondaryTypes = detail?.secondary_types || listItem?.secondary_types || [];
                  const trackCount = detail
                    ? detail.media.reduce((sum, m) => sum + m.track_count, 0)
                    : listItem?.track_count || 0;
                  const durationMs = detail ? getTotalDurationMs(detail) : 0;

                  return (
                    <>
                      <div class="text-sm font-medium text-[var(--color-text-primary)]">
                        {title}
                      </div>
                      <div class="text-xs text-[var(--color-text-secondary)] mt-0.5">
                        {formatArtistCredit(artistCredits)}
                      </div>
                      <div class="text-xs text-[var(--color-text-tertiary)] mt-0.5 flex gap-3 flex-wrap">
                        <Show when={date}>
                          <span>{date}</span>
                        </Show>
                        <Show when={country}>
                          <span>{country}</span>
                        </Show>
                        <span>{trackCount} tracks</span>
                        <Show when={durationMs > 0}>
                          <span>{formatLongDuration(Math.round(durationMs / 1000))}</span>
                        </Show>
                        <Show when={status}>
                          <span>{status}</span>
                        </Show>
                      </div>
                      <Show when={primaryType}>
                        <div class="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                          type: {primaryType}
                          <Show when={secondaryTypes.length > 0}>
                            {" "}
                            ({secondaryTypes.join(", ")})
                          </Show>
                        </div>
                      </Show>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* album metadata comparison */}
            <Show when={selectedRelease()}>
              <div class="mt-3 border-t border-[var(--color-border)] pt-3">
                <div class="flex items-center justify-between mb-2">
                  <div class="text-xs font-medium text-[var(--color-text-secondary)]">
                    metadata comparison
                    <Show when={changedFieldCount() > 0}>
                      <span class="text-yellow-500 ml-1">
                        ({changedFieldCount()} {changedFieldCount() === 1 ? "change" : "changes"})
                      </span>
                    </Show>
                  </div>
                  <Show when={changedFieldCount() > 0}>
                    <Button
                      onClick={handleImportAlbumMetadata}
                      variant="secondary"
                      disabled={importingAlbum()}
                    >
                      {importingAlbum()
                        ? "updating..."
                        : `update all ${changedFieldCount()} changes`}
                    </Button>
                  </Show>
                </div>

                {/* column headers */}
                <div class="grid grid-cols-[5rem_1fr_1fr_auto] gap-x-2 text-[10px] text-[var(--color-text-tertiary)] uppercase tracking-wide mb-1 px-1">
                  <span>field</span>
                  <span>current</span>
                  <span>musicbrainz</span>
                  <span class="w-16"></span>
                </div>

                {/* field rows */}
                <div class="space-y-0.5">
                  <For each={albumMetadataFields()}>
                    {(field) => {
                      const isUpdating = () => updatingField() === field.key;
                      return (
                        <div
                          class="grid grid-cols-[5rem_1fr_1fr_auto] gap-x-2 px-1 py-1 text-xs rounded"
                          classList={{
                            "bg-[var(--color-bg-elevated)]": !field.differs,
                            "bg-yellow-500/10": field.differs,
                          }}
                        >
                          {/* field label */}
                          <span class="text-[var(--color-text-tertiary)] flex-shrink-0 truncate">
                            {field.label}
                            <Show when={field.isArtistName}>
                              <span
                                class="text-[10px] opacity-50 block"
                                title="updates the artist record name, does not move to a different artist"
                              >
                                (rename)
                              </span>
                            </Show>
                          </span>

                          {/* current value */}
                          <div class="min-w-0 overflow-hidden">
                            <Show
                              when={field.currentValue}
                              fallback={
                                <span class="text-[var(--color-text-tertiary)] italic">—</span>
                              }
                            >
                              <Show
                                when={field.key === "genres"}
                                fallback={
                                  <span
                                    class="text-[var(--color-text-primary)] truncate block"
                                    classList={{
                                      "line-through opacity-50": field.differs,
                                    }}
                                  >
                                    {field.currentValue}
                                  </span>
                                }
                              >
                                <span
                                  classList={{
                                    "line-through opacity-50": field.differs,
                                  }}
                                >
                                  <MarqueeText
                                    text={field.currentValue}
                                    hoverOnly={true}
                                    class="text-[var(--color-text-primary)]"
                                  />
                                </span>
                              </Show>
                            </Show>
                          </div>

                          {/* MB value */}
                          <div class="min-w-0 overflow-hidden">
                            <Show
                              when={field.mbValue}
                              fallback={
                                <span class="text-[var(--color-text-tertiary)] italic">—</span>
                              }
                            >
                              <Show
                                when={field.key === "genres"}
                                fallback={
                                  <span
                                    class="text-[var(--color-text-primary)] truncate block"
                                    classList={{
                                      "text-[var(--color-accent-500)] font-medium": field.differs,
                                    }}
                                  >
                                    {field.mbValue}
                                  </span>
                                }
                              >
                                <MarqueeText
                                  text={field.mbValue}
                                  hoverOnly={true}
                                  class={
                                    field.differs
                                      ? "text-[var(--color-accent-500)] font-medium"
                                      : "text-[var(--color-text-primary)]"
                                  }
                                />
                              </Show>
                            </Show>
                          </div>

                          {/* action button */}
                          <div class="w-16 flex items-center justify-end">
                            <Show when={field.differs}>
                              <button
                                onClick={() => handleUpdateAlbumField(field)}
                                disabled={isUpdating() || importingAlbum()}
                                class="text-[10px] text-[var(--color-accent-500)] hover:text-[var(--color-accent-400)] disabled:opacity-30 disabled:cursor-default"
                              >
                                {isUpdating() ? "..." : "update"}
                              </button>
                            </Show>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>

                <Show when={changedFieldCount() === 0 && albumMetadataFields().length > 0}>
                  <div class="text-xs text-[var(--color-text-tertiary)] mt-2">
                    all metadata matches — nothing to update
                  </div>
                </Show>
              </div>
            </Show>
          </div>

          {/* album art images */}
          <Show when={!loadingRelease() && selectedRelease()?.cover_art_images?.length}>
            <MusicBrainzAlbumImages
              images={(selectedRelease()?.cover_art_images || []).map(
                (img) =>
                  ({
                    thumbUrl: getCoverArtThumbUrl(img),
                    fullUrl: getCoverArtFullUrl(img),
                    types: img.types,
                  }) as AlbumArtImage
              )}
              importingUrls={importingImages()}
              importedUrls={importedImages()}
              onImport={handleImportImage}
            />
          </Show>
          <Show
            when={
              !loadingRelease() &&
              (!selectedRelease()?.cover_art_images ||
                selectedRelease()?.cover_art_images?.length === 0) &&
              (selectedRelease() || selectedListItem())
            }
          >
            <div class="p-3 text-xs text-[var(--color-text-tertiary)]">no album art available</div>
          </Show>

          {/* side-by-side track comparison */}
          <Show when={!loadingRelease() && selectedRelease()}>
            <div class="p-3">
              <MusicBrainzTrackComparison
                release={selectedRelease()!}
                songs={props.songs}
                onAlbumUpdated={props.onAlbumUpdated}
              />
            </div>
          </Show>

          <Show when={loadingRelease()}>
            <div class="p-3 text-xs text-[var(--color-text-tertiary)]">
              loading track listing...
            </div>
          </Show>
        </div>
      </Show>

      {/* search results list */}
      <Show when={!selectedRelease() && !selectedListItem() && results().length > 0}>
        <div class="flex items-center justify-between text-xs text-[var(--color-text-tertiary)] mb-1">
          <div class="flex items-center gap-2">
            <span>
              {filteredResults().length} of {searchCount()} results
              {countryFilter() ? " (filtered)" : ""}
            </span>
            <Show when={uniqueCountries().length > 1}>
              <select
                value={countryFilter()}
                onChange={(e) => setCountryFilter(e.currentTarget.value)}
                class="bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] text-xs rounded px-1 py-0.5 outline-none"
              >
                <option value="">all countries</option>
                <option value="__none__">no country</option>
                <For each={uniqueCountries()}>
                  {(country) => <option value={country}>{country}</option>}
                </For>
              </select>
            </Show>
          </div>
        </div>
        <div class="rounded-lg">
          <For each={filteredResults()}>
            {(release) => (
              <button
                onClick={() => handleSelectRelease(release)}
                class="w-full text-left px-3 py-2 hover:bg-[var(--color-bg-hover)] transition-colors flex items-start gap-3"
              >
                <div class="w-10 h-10 flex-shrink-0 rounded bg-[var(--color-bg-base)] overflow-hidden relative">
                  <div class="absolute inset-0 flex items-center justify-center text-[var(--color-text-tertiary)]">
                    <Icon name={IconNames.music} size={16} />
                  </div>
                  <Show when={release.cover_art_url}>
                    <img
                      src={release.cover_art_url!}
                      alt=""
                      class="relative w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </Show>
                </div>

                <div class="flex-1 min-w-0">
                  <div class="text-sm text-[var(--color-text-primary)] truncate">
                    {release.title}
                  </div>
                  <div class="text-xs text-[var(--color-text-secondary)] truncate">
                    {formatArtistCredit(release.artist_credit)}
                  </div>
                  <div class="text-xs text-[var(--color-text-tertiary)] flex gap-2 mt-0.5">
                    <Show when={release.date}>
                      <span>{release.date}</span>
                    </Show>
                    <Show when={release.country}>
                      <span>{release.country}</span>
                    </Show>
                    <span
                      classList={{
                        "text-[var(--color-accent-500)]":
                          release.track_count === props.songs.length,
                      }}
                    >
                      {release.track_count} tracks
                    </span>
                    <Show when={release.primary_type}>
                      <span>{release.primary_type}</span>
                    </Show>
                    <Show when={release.label}>
                      <span class="truncate max-w-[120px]" title={release.label!}>
                        {release.label}
                      </span>
                    </Show>
                    <Show when={release.format}>
                      <span>{release.format}</span>
                    </Show>
                    <Show when={release.packaging}>
                      <span>{release.packaging}</span>
                    </Show>
                  </div>
                </div>

                <Show when={release.score != null}>
                  <div class="text-xs text-[var(--color-text-tertiary)] flex-shrink-0">
                    {release.score}%
                  </div>
                </Show>
              </button>
            )}
          </For>
        </div>
        <Show when={totalPages() > 1}>
          <div class="flex items-center justify-between text-xs text-[var(--color-text-tertiary)] mt-2">
            <button
              onClick={handlePrevPage}
              disabled={!hasPrev() || searching()}
              class="px-2 py-1 rounded hover:bg-[var(--color-bg-hover)] disabled:opacity-30 disabled:cursor-default"
            >
              prev
            </button>
            <span>
              page {currentPage()} of {totalPages()}
            </span>
            <button
              onClick={handleNextPage}
              disabled={!hasNext() || searching()}
              class="px-2 py-1 rounded hover:bg-[var(--color-bg-hover)] disabled:opacity-30 disabled:cursor-default"
            >
              next
            </button>
          </div>
        </Show>
      </Show>

      {/* empty state */}
      <Show
        when={
          !searching() &&
          hasSearched() &&
          !selectedRelease() &&
          !selectedListItem() &&
          results().length === 0
        }
      >
        <div class="text-sm text-[var(--color-text-tertiary)] text-center py-8">
          no results. try a different search.
        </div>
      </Show>
    </div>
  );
}
