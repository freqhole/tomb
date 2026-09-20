// pure, stateless parsing/coercion helpers extracted out of
// radioService.ts - none of these read or write any radio session
// state, they just turn raw wire/JSON payloads into typed shapes (or
// null on malformed input).

import { schema, type PublicNowPlaying } from "@freqhole/api-client";

export type RadioModeCapability = "chunk_stream" | "timeline_seed";

export interface RadioTimelineCurrentItem {
  timeline_item_id: string;
  song_id: string;
  start_at_ms: number;
  duration_ms: number | null;
}

export interface RadioTimelineUpcomingItem {
  timeline_item_id: string;
  song_id: string;
  planned_start_at_ms: number;
  duration_ms: number | null;
}

export interface RadioTimelineSnapshot {
  station_id: string;
  timeline_seq: number;
  station_epoch_ms: number;
  generated_at_ms: number;
  current: RadioTimelineCurrentItem | null;
  upcoming: RadioTimelineUpcomingItem[];
  lookahead_count: number;
}

// extract raw inline art metadata (`{mime, data}` base64) from the raw
// now_playing payload, for storing in history. returns null if absent.
export function rawArtMetaFrom(raw: unknown): { mime: string; data: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const art = (raw as { art?: unknown }).art;
  if (!art || typeof art !== "object") return null;
  const a = art as { mime?: unknown; data?: unknown };
  if (typeof a.mime !== "string" || typeof a.data !== "string") return null;
  return { mime: a.mime, data: a.data };
}

// build a Blob URL from inline ArtData (`{mime, blob_id, data}`) on the
// raw now_playing payload. returns null if missing/malformed.
export function artUrlFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const art = (raw as { art?: unknown }).art;
  if (!art || typeof art !== "object") return null;
  const a = art as { mime?: unknown; data?: unknown };
  if (typeof a.mime !== "string" || typeof a.data !== "string") return null;
  try {
    const bin = atob(a.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes as BlobPart], { type: a.mime });
    return URL.createObjectURL(blob);
  } catch (e) {
    console.warn("[radio] art decode failed:", e);
    return null;
  }
}

export function coerceModeCapabilities(raw: unknown): RadioModeCapability[] {
  if (!Array.isArray(raw)) return [];
  const out: RadioModeCapability[] = [];
  for (const item of raw) {
    if ((item === "chunk_stream" || item === "timeline_seed") && !out.includes(item)) {
      out.push(item);
    }
  }
  return out;
}

export function coerceTimelineSnapshot(raw: unknown): RadioTimelineSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const x = raw as {
    station_id?: unknown;
    timeline_seq?: unknown;
    station_epoch_ms?: unknown;
    generated_at_ms?: unknown;
    current?: unknown;
    upcoming?: unknown;
    lookahead_count?: unknown;
  };

  if (
    typeof x.station_id !== "string" ||
    typeof x.timeline_seq !== "number" ||
    typeof x.station_epoch_ms !== "number" ||
    typeof x.generated_at_ms !== "number"
  ) {
    return null;
  }

  const parseCurrent = (item: unknown): RadioTimelineCurrentItem | null => {
    if (!item || typeof item !== "object") return null;
    const y = item as {
      timeline_item_id?: unknown;
      song_id?: unknown;
      start_at_ms?: unknown;
      duration_ms?: unknown;
    };
    if (
      typeof y.timeline_item_id !== "string" ||
      typeof y.song_id !== "string" ||
      typeof y.start_at_ms !== "number"
    ) {
      return null;
    }
    return {
      timeline_item_id: y.timeline_item_id,
      song_id: y.song_id,
      start_at_ms: y.start_at_ms,
      duration_ms: typeof y.duration_ms === "number" ? y.duration_ms : null,
    };
  };

  const parseUpcoming = (item: unknown): RadioTimelineUpcomingItem | null => {
    if (!item || typeof item !== "object") return null;
    const y = item as {
      timeline_item_id?: unknown;
      song_id?: unknown;
      planned_start_at_ms?: unknown;
      duration_ms?: unknown;
    };
    if (
      typeof y.timeline_item_id !== "string" ||
      typeof y.song_id !== "string" ||
      typeof y.planned_start_at_ms !== "number"
    ) {
      return null;
    }
    return {
      timeline_item_id: y.timeline_item_id,
      song_id: y.song_id,
      planned_start_at_ms: y.planned_start_at_ms,
      duration_ms: typeof y.duration_ms === "number" ? y.duration_ms : null,
    };
  };

  const current = parseCurrent(x.current);
  const upcoming = Array.isArray(x.upcoming)
    ? x.upcoming.map(parseUpcoming).filter((u): u is RadioTimelineUpcomingItem => u !== null)
    : [];

  return {
    station_id: x.station_id,
    timeline_seq: x.timeline_seq,
    station_epoch_ms: x.station_epoch_ms,
    generated_at_ms: x.generated_at_ms,
    current,
    upcoming,
    lookahead_count: typeof x.lookahead_count === "number" ? x.lookahead_count : upcoming.length,
  };
}

function isArt(v: unknown): v is { blob_id?: unknown } {
  return !!v && typeof v === "object";
}

/**
 * coerce a meta `now_playing` blob into our `PublicNowPlaying` shape.
 * the wire format from the radio control stream sends the `NowPlaying`
 * struct (with `art: { mime, blob_id, data }`); the http `RadioInfo`
 * endpoint sends `art_blob_id` instead. this picks whichever fields are
 * present so views can render either source uniformly.
 */
export function coerceNowPlaying(raw: unknown): PublicNowPlaying | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const np: PublicNowPlaying = {
    kind: r.kind === "video" ? "video" : "song",
    song_id: typeof r.song_id === "string" ? r.song_id : "",
    title: typeof r.title === "string" ? r.title : "(untitled)",
    artist: typeof r.artist === "string" ? r.artist : null,
    album: typeof r.album === "string" ? r.album : null,
    art_blob_id:
      typeof r.art_blob_id === "string"
        ? r.art_blob_id
        : isArt(r.art) && typeof r.art.blob_id === "string"
          ? r.art.blob_id
          : null,
    waveform_blob_id: typeof r.waveform_blob_id === "string" ? r.waveform_blob_id : null,
    duration_ms: typeof r.duration_ms === "number" ? r.duration_ms : null,
  };
  // best-effort validate via the generated zod schema; ignore on failure
  // so unexpected fields don't blow up playback.
  const parsed = schema.PublicNowPlayingSchema.safeParse(np);
  return parsed.success ? parsed.data : np;
}
