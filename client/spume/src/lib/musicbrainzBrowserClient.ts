// musicbrainz browser client
//
// calls musicbrainz ws/2 and cover art archive directly from the browser.
// maps raw api responses to the same types used by the backend proxy so
// the MusicBrainzPanel component works with either data source.
//
// rate limiting: musicbrainz asks for max 1 req/sec per ip.
// this client enforces a simple 1-second minimum gap between requests.
// for light storybook / local-library use this is more than sufficient.
//
// cors: mb ws/2 and coverartarchive both allow cross-origin requests.
// the User-Agent header cannot be set from a browser (it's blocked by
// the fetch spec), but mb doesn't enforce the custom UA requirement for
// browser traffic.

import { z } from "zod";
import type {
  MbSearchReleasesResponse,
  MbReleaseDetail,
  MbReleaseListItem,
  MbArtistCredit,
  MbMedium,
  MbTrack,
  MbCoverArtImage,
  MbCoverArtThumbnails,
} from "../music/data/types";

// -------------------------------------------------------------------------
// zod schemas for raw mb ws/2 api responses
// -------------------------------------------------------------------------

export const RawArtistCreditSchema = z.object({
  name: z.string(),
  joinphrase: z.string().nullable().optional(),
  artist: z
    .object({ id: z.string(), name: z.string() })
    .optional(),
});

export const RawTrackSchema = z.object({
  position: z.number().nullable().optional(),
  title: z.string(),
  length: z.number().nullable().optional(),
  "artist-credit": z.array(RawArtistCreditSchema).nullable().optional(),
  recording: z
    .object({
      length: z.number().nullable().optional(),
      "artist-credit": z.array(RawArtistCreditSchema).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const RawMediumSchema = z.object({
  position: z.number().nullable().optional(),
  title: z.string().nullable().optional(),
  format: z.string().nullable().optional(),
  tracks: z.array(RawTrackSchema).nullable().optional(),
  "track-count": z.number().nullable().optional(),
});

export const RawReleaseGroupSchema = z.object({
  id: z.string().optional(),
  "primary-type": z.string().nullable().optional(),
  "secondary-types": z.array(z.string()).nullable().optional(),
  genres: z.array(z.object({ name: z.string(), count: z.number().optional() })).nullable().optional(),
  tags: z.array(z.object({ name: z.string(), count: z.number().optional() })).nullable().optional(),
});

export const RawLabelInfoSchema = z.object({
  label: z.object({ name: z.string() }).nullable().optional(),
});

export const RawCoverArtArchiveSchema = z.object({
  front: z.boolean().optional(),
  artwork: z.boolean().optional(),
});

export const RawReleaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  date: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
  packaging: z.string().nullable().optional(),
  "artist-credit": z.array(RawArtistCreditSchema).nullable().optional(),
  media: z.array(RawMediumSchema).nullable().optional(),
  "release-group": RawReleaseGroupSchema.nullable().optional(),
  "label-info": z.array(RawLabelInfoSchema).nullable().optional(),
  "cover-art-archive": RawCoverArtArchiveSchema.nullable().optional(),
  genres: z.array(z.object({ name: z.string(), count: z.number().optional() })).nullable().optional(),
});

export const RawSearchResponseSchema = z.object({
  releases: z.array(RawReleaseSchema).default([]),
  count: z.number().default(0),
  offset: z.number().default(0),
});

export const RawCoverArtImageSchema = z.object({
  id: z.union([z.string(), z.number()]),
  image: z.string(),
  thumbnails: z
    .object({
      small: z.string().optional(),
      large: z.string().optional(),
      "250": z.string().optional(),
      "500": z.string().optional(),
      "1200": z.string().optional(),
    })
    .optional(),
  types: z.array(z.string()).default([]),
  front: z.boolean(),
  back: z.boolean(),
  comment: z.string().nullable().optional(),
});

export const RawCoverArtResponseSchema = z.object({
  images: z.array(RawCoverArtImageSchema).default([]),
});

// inferred raw types
export type RawArtistCredit = z.infer<typeof RawArtistCreditSchema>;
export type RawTrack = z.infer<typeof RawTrackSchema>;
export type RawMedium = z.infer<typeof RawMediumSchema>;
export type RawRelease = z.infer<typeof RawReleaseSchema>;
export type RawSearchResponse = z.infer<typeof RawSearchResponseSchema>;
export type RawCoverArtResponse = z.infer<typeof RawCoverArtResponseSchema>;

// -------------------------------------------------------------------------
// mapping helpers
// -------------------------------------------------------------------------

function mapArtistCredits(raw: RawArtistCredit[] | null | undefined): MbArtistCredit[] {
  return (raw ?? []).map((ac) => ({
    name: ac.name,
    joinphrase: ac.joinphrase ?? null,
  }));
}

function mapTrack(raw: RawTrack): MbTrack {
  const length = raw.length ?? raw.recording?.length ?? null;
  const artistCredit =
    raw["artist-credit"] ??
    raw.recording?.["artist-credit"] ??
    null;
  return {
    position: raw.position ?? null,
    title: raw.title,
    length_ms: length ?? null,
    artist_credit: mapArtistCredits(artistCredit),
  };
}

function mapMedium(raw: RawMedium): MbMedium {
  return {
    position: raw.position ?? null,
    title: raw.title ?? null,
    format: raw.format ?? null,
    tracks: (raw.tracks ?? []).map(mapTrack),
    track_count: raw["track-count"] ?? raw.tracks?.length ?? 0,
  };
}

function joinLabels(labelInfo: z.infer<typeof RawLabelInfoSchema>[] | null | undefined): string | null {
  if (!labelInfo?.length) return null;
  const seen = new Set<string>();
  const names: string[] = [];
  for (const li of labelInfo) {
    const name = li.label?.name;
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names.length ? names.join(" / ") : null;
}

function releaseTrackCount(media: RawMedium[] | null | undefined): number {
  return (media ?? []).reduce((sum, m) => sum + (m["track-count"] ?? m.tracks?.length ?? 0), 0);
}

export function hasCoverArt(caa: z.infer<typeof RawCoverArtArchiveSchema> | null | undefined): boolean {
  return !!(caa?.front || caa?.artwork);
}

export function coverArtThumbUrl(id: string): string {
  return `https://coverartarchive.org/release/${id}/front-250`;
}

function joinFormats(media: RawMedium[] | null | undefined): string | null {
  const seen = new Set<string>();
  const formats: string[] = [];
  for (const m of media ?? []) {
    if (m.format && !seen.has(m.format)) {
      seen.add(m.format);
      formats.push(m.format);
    }
  }
  return formats.length ? formats.join(" + ") : null;
}

export function mapReleaseToListItem(r: RawRelease): MbReleaseListItem {
  const rg = r["release-group"];
  return {
    id: r.id,
    title: r.title,
    date: r.date ?? null,
    country: r.country ?? null,
    status: r.status ?? null,
    score: r.score ?? null,
    artist_credit: mapArtistCredits(r["artist-credit"]),
    track_count: releaseTrackCount(r.media),
    has_cover_art: hasCoverArt(r["cover-art-archive"]),
    cover_art_url: coverArtThumbUrl(r.id),
    primary_type: rg?.["primary-type"] ?? null,
    secondary_types: rg?.["secondary-types"] ?? [],
    label: joinLabels(r["label-info"]),
    format: joinFormats(r.media),
    packaging: r.packaging ?? null,
  };
}

function pickGenres(r: RawRelease): string[] {
  const rg = r["release-group"];
  const rgGenres = rg?.genres ?? rg?.tags ?? [];
  const relGenres = r.genres ?? [];
  const source = rgGenres.length >= relGenres.length ? rgGenres : relGenres;
  return [...source].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).map((g) => g.name);
}

export function mapReleaseToDetail(r: RawRelease): MbReleaseDetail {
  const rg = r["release-group"];
  return {
    id: r.id,
    title: r.title,
    date: r.date ?? null,
    country: r.country ?? null,
    status: r.status ?? null,
    artist_credit: mapArtistCredits(r["artist-credit"]),
    media: (r.media ?? []).map(mapMedium),
    primary_type: rg?.["primary-type"] ?? null,
    secondary_types: rg?.["secondary-types"] ?? [],
    has_cover_art: hasCoverArt(r["cover-art-archive"]),
    cover_art_url: coverArtThumbUrl(r.id),
    cover_art_images: [], // populated by fetchCoverArt below
    genres: pickGenres(r),
    label: joinLabels(r["label-info"]),
  };
}

export function mapCoverArtImages(raw: z.infer<typeof RawCoverArtResponseSchema>): MbCoverArtImage[] {
  return raw.images.map((img): MbCoverArtImage => {
    const thumbnails: MbCoverArtThumbnails = {
      small: img.thumbnails?.small ?? null,
      large: img.thumbnails?.large ?? null,
      thumb_250: img.thumbnails?.["250"] ?? null,
      thumb_500: img.thumbnails?.["500"] ?? null,
      thumb_1200: img.thumbnails?.["1200"] ?? null,
    };
    return {
      id: String(img.id),
      image_url: img.image,
      thumbnails,
      types: img.types,
      front: img.front,
      back: img.back,
      comment: img.comment ?? null,
    };
  });
}

// -------------------------------------------------------------------------
// rate limiter - enforces minimum gap between requests
// -------------------------------------------------------------------------

class RateLimiter {
  private lastRequestAt = 0;
  private readonly minGapMs: number;

  constructor(minGapMs = 1100) {
    this.minGapMs = minGapMs;
  }

  async throttle(): Promise<void> {
    const now = Date.now();
    const wait = this.minGapMs - (now - this.lastRequestAt);
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    this.lastRequestAt = Date.now();
  }
}

// -------------------------------------------------------------------------
// browser client
// -------------------------------------------------------------------------

export interface MbBrowserClientOptions {
  /** override the mb ws2 base url (default: https://musicbrainz.org/ws/2) */
  wsBaseUrl?: string;
  /** override the cover art archive base url (default: https://coverartarchive.org) */
  caaBaseUrl?: string;
  /** min ms between requests (default: 1100 to stay under mb's 1/sec limit) */
  minGapMs?: number;
}

export class MusicBrainzBrowserClient {
  private readonly ws: string;
  private readonly caa: string;
  private readonly limiter: RateLimiter;

  constructor(opts: MbBrowserClientOptions = {}) {
    this.ws = opts.wsBaseUrl ?? "https://musicbrainz.org/ws/2";
    this.caa = opts.caaBaseUrl ?? "https://coverartarchive.org";
    this.limiter = new RateLimiter(opts.minGapMs ?? 1100);
  }

  private async get(url: string): Promise<unknown> {
    await this.limiter.throttle();
    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) {
      throw new Error(`mb request failed: ${resp.status} ${url}`);
    }
    return resp.json();
  }

  /** search releases - returns list items matching the query */
  async searchReleases(params: {
    release?: string | null;
    artist?: string | null;
    limit?: number | null;
    offset?: number | null;
  }): Promise<MbSearchReleasesResponse> {
    const parts: string[] = [];
    if (params.release) parts.push(`release:${encodeQueryTerm(params.release)}`);
    if (params.artist) parts.push(`artist:${encodeQueryTerm(params.artist)}`);
    if (!parts.length) throw new Error("at least one of release or artist is required");

    const query = parts.join(" AND ");
    const limit = params.limit ?? 25;
    const offset = params.offset ?? 0;

    const url =
      `${this.ws}/release?query=${encodeURIComponent(query)}` +
      `&limit=${limit}&offset=${offset}&fmt=json` +
      `&inc=artist-credits+release-groups+labels+media+tags`;

    const json = await this.get(url);
    const raw = RawSearchResponseSchema.parse(json);

    return {
      results: raw.releases.map(mapReleaseToListItem),
      count: raw.count,
      offset: raw.offset,
    };
  }

  /** get a single release by mbid - includes tracks and cover art */
  async getRelease(mbid: string): Promise<MbReleaseDetail | null> {
    const url =
      `${this.ws}/release/${mbid}?fmt=json` +
      `&inc=artist-credits+release-groups+labels+media+recordings+artist-credits+genres+tags`;

    let detail: MbReleaseDetail;
    try {
      const json = await this.get(url);
      const raw = RawReleaseSchema.parse(json);
      detail = mapReleaseToDetail(raw);
    } catch {
      return null;
    }

    // fetch cover art archive separately (uses redirect, needs separate request)
    try {
      detail.cover_art_images = await this.fetchCoverArt(mbid);
    } catch {
      // cover art is optional - silently ignore failures
    }

    return detail;
  }

  /** fetch cover art images from coverartarchive.org */
  async fetchCoverArt(mbid: string): Promise<MbCoverArtImage[]> {
    const url = `${this.caa}/release/${mbid}`;
    await this.limiter.throttle();

    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (resp.status === 404) return [];
    if (!resp.ok) throw new Error(`cover art archive request failed: ${resp.status}`);

    const raw = RawCoverArtResponseSchema.parse(await resp.json());
    return mapCoverArtImages(raw);
  }
}

// -------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------

/** escape a term for mb lucene query syntax */
export function encodeQueryTerm(term: string): string {
  // wrap multi-word terms in quotes
  const safe = term.replace(/"/g, '\\"');
  return term.includes(" ") ? `"${safe}"` : safe;
}

/** singleton for general use */
export const mbBrowserClient = new MusicBrainzBrowserClient();
