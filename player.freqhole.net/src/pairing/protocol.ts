// wire schema for the pairing handshake, sent as a single ndjson line over
// a freqhole-player/1 bi-stream (see midden/acceptLoop.ts).
//
// the connecting node's identity comes from the QUIC/iroh handshake itself
// (`stream.peer_node_id()`) - never trust a node id supplied inside the
// message body.

import { z } from "zod";

export const PairRequestSchema = z.object({
  type: z.literal("pair_request"),
  pin: z.string(),
  display_name: z.string().min(1).max(64),
});
export type PairRequest = z.infer<typeof PairRequestSchema>;

export const PairResponseSchema = z.object({
  type: z.literal("pair_response"),
  ok: z.boolean(),
  reason: z.enum(["invalid_pin", "rate_limited"]).optional(),
});
export type PairResponse = z.infer<typeof PairResponseSchema>;
