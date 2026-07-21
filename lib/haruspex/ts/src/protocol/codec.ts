// friendz message codec: json wire encode/decode plus a length-delimited
// framing layer for transports that give raw bytes with no message
// boundaries of their own.
//
// the 20 rust fixture files (haruspex/rust/fixtures/protocol/) are the
// pre-framing json payload shape - not length-delimited bytes - so
// decodeMessage/encodeMessage below operate on that same json shape, and
// framing is a separate, optional layer on top for callers whose
// transport needs it.

import { CoreMessageSchema, isCoreMessageType, type CoreMessage } from "./messages.js";
import { isAppExtensionType, type AppExtensionMessage } from "./extensions.js";

/**
 * the full friendz protocol message set, decoded: every core (unified)
 * message, tagged as such, or a namespaced app-extension passthrough this
 * package never inspects the shape of.
 */
export type FriendzMessage =
  | { kind: "core"; message: CoreMessage }
  | ({ kind: "app-extension" } & AppExtensionMessage);

/** the wire `type` discriminant of a decoded message, for logging/dispatch. */
export function friendzMessageType(msg: FriendzMessage): string {
  return msg.kind === "core" ? msg.message.type : msg.messageType;
}

/**
 * validate + decode a raw json value (already parsed, not yet bytes) into
 * a FriendzMessage. a `type` containing `:` is routed to the app-extension
 * passthrough without inspecting its payload shape further; anything else
 * is validated against the core message union and is a real protocol
 * error (thrown) if it matches no core variant.
 */
export function decodeFriendzMessage(raw: unknown): FriendzMessage {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("friendz message must be a json object");
  }
  const obj = raw as Record<string, unknown>;
  const type = obj["type"];
  if (typeof type !== "string" || type.length === 0) {
    throw new Error("friendz message is missing a string 'type' field");
  }

  if (isAppExtensionType(type)) {
    return { kind: "app-extension", messageType: type, payload: obj };
  }

  if (!isCoreMessageType(type)) {
    throw new Error(`unknown friendz message type "${type}"`);
  }

  const message = CoreMessageSchema.parse(obj);
  return { kind: "core", message };
}

/** flatten a FriendzMessage back to the plain json object the wire sends. */
export function encodeFriendzMessageToJson(msg: FriendzMessage): Record<string, unknown> {
  return msg.kind === "core" ? (msg.message as Record<string, unknown>) : msg.payload;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** encode a message to its utf-8 json wire bytes, unframed. */
export function encodeMessage(msg: FriendzMessage): Uint8Array {
  return encoder.encode(JSON.stringify(encodeFriendzMessageToJson(msg)));
}

/** parse utf-8 json wire bytes into a validated, decoded FriendzMessage. */
export function decodeMessage(bytes: Uint8Array): FriendzMessage {
  const text = decoder.decode(bytes);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("friendz message bytes are not valid json");
  }
  return decodeFriendzMessage(raw);
}

// ---------------------------------------------------------------------------
// length-delimited framing
//
// for a transport that hands over raw bytes with no message-boundary
// framing of its own (unlike a midden BiStream, whose write_message/
// read_message already frame each call - see client.ts). a 4-byte
// big-endian u32 length prefix precedes each encoded message, matching
// this workspace's existing length-delimited wire convention.
// ---------------------------------------------------------------------------

/** encode a message as one length-delimited frame: a 4-byte be length + payload. */
export function frameMessage(msg: FriendzMessage): Uint8Array {
  const payload = encodeMessage(msg);
  const frame = new Uint8Array(4 + payload.byteLength);
  new DataView(frame.buffer).setUint32(0, payload.byteLength, false);
  frame.set(payload, 4);
  return frame;
}

/**
 * accumulates bytes fed via push() and yields fully-framed messages as
 * they complete - handles a message arriving split across multiple reads
 * (typical for a raw byte stream) or several messages arriving in one
 * chunk.
 */
export class FrameReader {
  private buffer = new Uint8Array(0);

  /** feed newly received bytes in; returns every message that completed. */
  push(chunk: Uint8Array): FriendzMessage[] {
    const merged = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.byteLength);
    this.buffer = merged;

    const messages: FriendzMessage[] = [];
    for (;;) {
      if (this.buffer.byteLength < 4) break;
      const length = new DataView(this.buffer.buffer, this.buffer.byteOffset).getUint32(0, false);
      if (this.buffer.byteLength < 4 + length) break;
      const payload = this.buffer.subarray(4, 4 + length);
      messages.push(decodeMessage(payload));
      this.buffer = this.buffer.subarray(4 + length);
    }
    return messages;
  }

  /** bytes buffered so far that don't yet form a complete frame. */
  pendingByteLength(): number {
    return this.buffer.byteLength;
  }
}
