// generic `BiStreamLike` doubles for exercising a request/reply protocol
// built on top of length-delimited messages, without any real peer on the
// other end: `CollectingStream` records every write for later assertions,
// and `makeServingStream` scripts replies to blob-request-shaped messages
// from a blake3-keyed lookup table.
//
// both default to a plain json wire format (`encodeJsonMessage`/
// `decodeJsonMessage`) since this package has no wire protocol of its
// own to assume - a consumer with its own message codec (cbor, a custom
// binary framing, ...) supplies its own `encode`/`decode` instead.

import type { BiStreamLike } from "../automerge/types.js";

const DEFAULT_ALPN = "reliquary/testing/1";
const DEFAULT_PEER_ID = "peer-a";

/** encodes a message as utf-8 json bytes. */
export function encodeJsonMessage(message: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(message));
}

/** decodes utf-8 json bytes back into a message. */
export function decodeJsonMessage<TMessage = unknown>(data: Uint8Array): TMessage {
  return JSON.parse(new TextDecoder().decode(data)) as TMessage;
}

export interface CollectingStreamOptions<TMessage> {
  peerId?: string;
  alpn?: string;
  /** decodes a written frame into a message for `sent`. defaults to
   *  `decodeJsonMessage`. */
  decode?(data: Uint8Array): TMessage;
}

/**
 * a `BiStreamLike` double that never has anything to read and simply
 * records every write - for exercising the serving side of a protocol in
 * isolation (assert on what got sent back, without needing a live peer to
 * read it).
 */
export class CollectingStream<TMessage = unknown> implements BiStreamLike {
  readonly sent: TMessage[] = [];
  private isClosed = false;
  private readonly peerId: string;
  private readonly streamAlpn: string;
  private readonly decode: (data: Uint8Array) => TMessage;

  constructor(options: CollectingStreamOptions<TMessage> = {}) {
    this.peerId = options.peerId ?? DEFAULT_PEER_ID;
    this.streamAlpn = options.alpn ?? DEFAULT_ALPN;
    this.decode = options.decode ?? (decodeJsonMessage as (data: Uint8Array) => TMessage);
  }

  async write_message(data: Uint8Array): Promise<void> {
    this.sent.push(this.decode(data));
  }

  async read_message(): Promise<Uint8Array | null> {
    return null;
  }

  close(): void {
    this.isClosed = true;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  peer_node_id(): string {
    return this.peerId;
  }

  alpn(): string {
    return this.streamAlpn;
  }
}

/** what a scripted serving stream knows about one blob, keyed by whatever
 *  id the request message addresses it by. */
export interface ServingStreamEntry {
  blake3: string;
  size: number;
  mime?: string;
}

export interface MakeServingStreamOptions<TMessage> {
  peerId?: string;
  alpn?: string;
  encode?(message: TMessage): Uint8Array;
  decode?(data: Uint8Array): TMessage;
  /** pulls the requested blob's id out of a decoded write, or `null` when
   *  the message isn't a blob request. defaults to reading
   *  `{ type: "blob_request", id }`. */
  requestId?(message: TMessage): string | null;
  /** builds the reply for a request id, given the matching table entry
   *  (or `undefined` on a miss). defaults to
   *  `{ type: "blob_ready", id, blake3, size, mime }` on a hit and
   *  `{ type: "error", code: "blob_not_found", id }` on a miss. */
  buildReply?(id: string, entry: ServingStreamEntry | undefined): TMessage;
}

function defaultRequestId(message: unknown): string | null {
  const m = message as { type?: unknown; id?: unknown };
  return m.type === "blob_request" && typeof m.id === "string" ? m.id : null;
}

function defaultBuildReply(id: string, entry: ServingStreamEntry | undefined): unknown {
  if (!entry) {
    return { type: "error", code: "blob_not_found", id };
  }
  return { type: "blob_ready", id, blake3: entry.blake3, size: entry.size, mime: entry.mime };
}

/**
 * a `BiStreamLike` double that scripts replies to blob-request-shaped
 * messages from a blake3-keyed lookup table - the fetching side of a
 * protocol driven against fixed, known responses instead of a live peer.
 * every write is checked against `requestId`; a match queues a
 * `buildReply` result to be read back by the next `read_message()` call.
 */
export function makeServingStream<TMessage = { type: string; id: string }>(
  table: Record<string, ServingStreamEntry>,
  options: MakeServingStreamOptions<TMessage> = {}
): BiStreamLike & { closed: boolean } {
  const encode = options.encode ?? (encodeJsonMessage as (message: TMessage) => Uint8Array);
  const decode = options.decode ?? (decodeJsonMessage as (data: Uint8Array) => TMessage);
  const requestId = options.requestId ?? (defaultRequestId as (message: TMessage) => string | null);
  const buildReply = options.buildReply ?? (defaultBuildReply as (id: string, entry: ServingStreamEntry | undefined) => TMessage);

  const replies: TMessage[] = [];

  return {
    closed: false,

    async write_message(data: Uint8Array): Promise<void> {
      const message = decode(data);
      const id = requestId(message);
      if (id !== null) {
        replies.push(buildReply(id, table[id]));
      }
    },

    async read_message(): Promise<Uint8Array | null> {
      const message = replies.shift();
      return message === undefined ? null : encode(message);
    },

    close(): void {
      this.closed = true;
    },

    peer_node_id: () => options.peerId ?? DEFAULT_PEER_ID,
    alpn: () => options.alpn ?? DEFAULT_ALPN,
  };
}
