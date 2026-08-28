// control command protocol (phase 3): messages a trusted controller sends
// to command playback, and status messages the player sends back.
//
// sent as ndjson lines over a freqhole-player/1 bi-stream, same as pairing
// (see midden/acceptLoop.ts) - the difference is the connecting node id
// must already be in the trust store (pairing/trustStore.ts).

import { z } from "zod";

const MediaRefSchema = z.object({
  /** peer address (or node id) of the remote the media lives on. */
  source_peer_addr: z.string(),
  /** blake3 hash of the media blob. */
  blake3_hash: z.string(),
  /** total size in bytes, if known (enables progress reporting). */
  size_bytes: z.number().nonnegative().optional(),
  /** track duration in ms, if known (enables queue/now-playing time display). */
  duration_ms: z.number().nonnegative().optional(),
  /** mime type hint for the <audio>/<video> element (default: audio/mpeg). */
  mime_type: z.string().optional(),
  /** drives full-screen playback for video vs the compact audio/queue view. */
  kind: z.enum(["audio", "video"]).optional(),
  title: z.string().optional(),
  artist: z.string().optional(),
  artwork_url: z.string().optional(),
});
export type MediaRef = z.infer<typeof MediaRefSchema>;

export const PlayerCommandSchema = z.discriminatedUnion("command", [
  z.object({ type: z.literal("control"), command: z.literal("play"), item: MediaRefSchema }),
  z.object({
    type: z.literal("control"),
    command: z.literal("replace_queue"),
    items: z.array(MediaRefSchema),
  }),
  z.object({
    type: z.literal("control"),
    command: z.literal("append_queue"),
    items: z.array(MediaRefSchema),
  }),
  z.object({ type: z.literal("control"), command: z.literal("pause") }),
  z.object({ type: z.literal("control"), command: z.literal("resume") }),
  z.object({
    type: z.literal("control"),
    command: z.literal("seek"),
    position_ms: z.number().nonnegative(),
  }),
  z.object({ type: z.literal("control"), command: z.literal("skip") }),
  z.object({
    type: z.literal("control"),
    command: z.literal("set_volume"),
    volume: z.number().min(0).max(1),
  }),
  z.object({ type: z.literal("control"), command: z.literal("stop") }),
  z.object({ type: z.literal("control"), command: z.literal("get_status") }),
  z.object({
    type: z.literal("control"),
    command: z.literal("tune_radio"),
    peer_addr: z.string(),
    station_id: z.string().optional(),
  }),
  z.object({ type: z.literal("control"), command: z.literal("stop_radio") }),
]);
export type PlayerCommand = z.infer<typeof PlayerCommandSchema>;

// `queue` (the full upcoming queue, current item first) rides along on every
// status variant so a reconnecting controller can resync via `get_status`
// instead of only learning about the single currently-playing item.
export const PlayerStatusSchema = z.discriminatedUnion("state", [
  z.object({
    type: z.literal("status"),
    state: z.literal("now_playing"),
    item: MediaRefSchema,
    position_ms: z.number().nonnegative(),
    queue: z.array(MediaRefSchema),
  }),
  z.object({
    type: z.literal("status"),
    state: z.literal("paused"),
    position_ms: z.number().nonnegative(),
    queue: z.array(MediaRefSchema),
  }),
  z.object({
    type: z.literal("status"),
    state: z.literal("buffering"),
    queue: z.array(MediaRefSchema),
  }),
  z.object({
    type: z.literal("status"),
    state: z.literal("stopped"),
    queue: z.array(MediaRefSchema),
  }),
  z.object({
    type: z.literal("status"),
    state: z.literal("error"),
    message: z.string(),
    queue: z.array(MediaRefSchema),
  }),
]);
export type PlayerStatus = z.infer<typeof PlayerStatusSchema>;

export const CommandAckSchema = z.object({
  type: z.literal("command_ack"),
  ok: z.boolean(),
  reason: z.enum(["untrusted", "invalid_command"]).optional(),
  status: PlayerStatusSchema.optional(),
});
export type CommandAck = z.infer<typeof CommandAckSchema>;
