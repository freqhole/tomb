import { describe, expect, it } from "vitest";
import { pickStreamStation } from "./pickStreamStation";
import type { PublicStation } from "@freqhole/api-client";

function station(overrides: Partial<PublicStation> = {}): PublicStation {
  return {
    station_id: "station-1",
    name: "a station",
    description: null,
    listener_count: 0,
    is_default: false,
    is_public: true,
    is_running: true,
    accepts_requests: true,
    content_mode: "video_only",
    now_playing: {
      kind: "video",
      song_id: "",
      title: "",
      artist: null,
      album: null,
      art_blob_id: null,
      waveform_blob_id: null,
      audio_blob_id: null,
      duration_ms: null,
    },
    ...overrides,
  };
}

describe("pickStreamStation", () => {
  it("returns null when there are no stations at all", () => {
    expect(pickStreamStation([])).toBeNull();
  });

  it("excludes stations that don't accept requests", () => {
    const stations = [station({ station_id: "s1", accepts_requests: false })];
    expect(pickStreamStation(stations)).toBeNull();
  });

  it("excludes audio_only stations (incompatible with video)", () => {
    const stations = [station({ station_id: "s1", content_mode: "audio_only" })];
    expect(pickStreamStation(stations)).toBeNull();
  });

  it("includes audio_or_video and video_only stations", () => {
    const stations = [station({ station_id: "s1", content_mode: "audio_or_video" })];
    expect(pickStreamStation(stations)?.station_id).toBe("s1");
  });

  it("picks the only qualifying station when there's just one", () => {
    const stations = [station({ station_id: "only-one" })];
    expect(pickStreamStation(stations)?.station_id).toBe("only-one");
  });

  it("prefers a running station over a cold one", () => {
    const stations = [
      station({ station_id: "cold", is_running: false }),
      station({ station_id: "warm", is_running: true }),
    ];
    expect(pickStreamStation(stations)?.station_id).toBe("warm");
  });

  it("tie-breaks toward the default station when running-ness matches", () => {
    const stations = [
      station({ station_id: "a-not-default", is_default: false }),
      station({ station_id: "b-default", is_default: true }),
    ];
    expect(pickStreamStation(stations)?.station_id).toBe("b-default");
  });

  it("tie-breaks toward station id for full determinism as a last resort", () => {
    const stations = [
      station({ station_id: "zebra" }),
      station({ station_id: "apple" }),
    ];
    expect(pickStreamStation(stations)?.station_id).toBe("apple");
  });

  it("running beats default - a running non-default station wins over a cold default one", () => {
    const stations = [
      station({ station_id: "cold-default", is_running: false, is_default: true }),
      station({ station_id: "warm-not-default", is_running: true, is_default: false }),
    ];
    expect(pickStreamStation(stations)?.station_id).toBe("warm-not-default");
  });
});
