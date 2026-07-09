// the app-extension mechanism: an unknown `type` string containing a `:`
// (e.g. "skein:canvas-invite", "playlistz:list-playlists") is a namespaced
// message this package never inspects the shape of - only the framing and
// the `:`-prefixed routing convention belong to it. a `type` with no `:`
// that doesn't match any core message is a real protocol error instead
// (see codec.ts's decodeFriendzMessage).
//
// an app registers a zod schema for its own extension message types here,
// so it can parse a received app-extension payload with its own shape
// without forking this package.

import type { z } from "zod";

/** a namespaced app-extension message: the raw payload, unparsed. */
export interface AppExtensionMessage {
  /** the wire `type` string, e.g. "skein:canvas-invite". */
  messageType: string;
  /** the full received json object, including `type` and `v`. */
  payload: Record<string, unknown>;
}

/** does `type` look like an app-extension message (has a `:` in it)? */
export function isAppExtensionType(type: string): boolean {
  return type.includes(":");
}

/**
 * a registry of zod schemas for app-extension message types, keyed by the
 * exact wire `type` string. lets a consuming app parse its own extension
 * payloads with real types instead of a raw `Record<string, unknown>`.
 */
export interface AppExtensionRegistry {
  /** register a schema for one exact message type (e.g. "skein:canvas-invite"). */
  register<T>(messageType: string, schema: z.ZodType<T>): void;
  /** remove a previously registered schema. */
  unregister(messageType: string): void;
  /** is a schema registered for this message type? */
  isRegistered(messageType: string): boolean;
  /**
   * parse an app-extension message's payload against its registered
   * schema. throws if no schema is registered, or if the payload doesn't
   * match - use `isRegistered` first to fall back to the raw payload
   * instead of throwing.
   */
  parse<T = unknown>(message: AppExtensionMessage): T;
}

/** create a fresh, empty app-extension registry. */
export function createAppExtensionRegistry(): AppExtensionRegistry {
  const schemas = new Map<string, z.ZodType>();

  return {
    register(messageType, schema) {
      schemas.set(messageType, schema as z.ZodType);
    },
    unregister(messageType) {
      schemas.delete(messageType);
    },
    isRegistered(messageType) {
      return schemas.has(messageType);
    },
    parse<T = unknown>(message: AppExtensionMessage): T {
      const schema = schemas.get(message.messageType);
      if (!schema) {
        throw new Error(`no schema registered for app-extension type "${message.messageType}"`);
      }
      return schema.parse(message.payload) as T;
    },
  };
}
