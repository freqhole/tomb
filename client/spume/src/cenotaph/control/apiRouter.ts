// generic freqhole/1 request/response router: generalizes what used to be
// a single hardcoded "GET /api/hello" branch into a real
// `registerRoute()` table, so future routes can be added without touching
// the wire-framing code here at all.
//
// the wire envelope (`api_request`/`api_response`, ndjson-free single
// request/response per stream) matches grimoire's own native federation
// transport and midden's dial-side `api_request()` client - see
// lib/midden/src/lib.rs.
//
// route auth mirrors grimoire's own `RouteAuth`/`UserRole` pattern (see
// grimoire/src/api_registry and grimoire/src/users/models.rs) directly:
// `"public"` (open to anyone, e.g. a hello/probe route) or a minimum role
// - `"viewer"` | `"member"` | `"admin"` (root deliberately omitted here,
// same as the `peers_allow` role picker) - the peer must meet or exceed.
// cenotaph itself has no opinion on how roles are assigned; the host app
// injects a `resolvePeerRole` callback via `createApiRouter(options)` that
// answers "what role (if any) does this node_id have" (see
// docs/player-peer-trust-bridge-plan.md's implementation plan, step 4).

import type { CenotaphBiStream } from "../midden/node";
import { ROLE_LEVEL, type PeerRole } from "../pairing/trustStore";

export interface ApiRouteHandler {
  (body: unknown): Promise<{ status: number; body: unknown }> | { status: number; body: unknown };
}

/** re-exported for callers that only import from apiRouter.ts - same
 * type as `PeerRole` in pairing/trustStore.ts, kept as one canonical
 * definition there since roles are assigned at pairing time. */
export type ApiPeerRole = PeerRole;

/** `"public"`: no auth check at all. otherwise: the minimum `ApiPeerRole`
 * the requester must have, per the injected `resolvePeerRole` check. */
export type ApiRouteAuth = "public" | ApiPeerRole;

interface RegisteredRoute {
  handler: ApiRouteHandler;
  auth: ApiRouteAuth;
}

interface ApiRequestMessage {
  type: "api_request";
  id: number;
  method: string;
  path: string;
  body: string | null;
}

function isApiRequestMessage(value: unknown): value is ApiRequestMessage {
  return (
    !!value && typeof value === "object" && (value as { type?: unknown }).type === "api_request"
  );
}

async function writeApiResponse(
  stream: CenotaphBiStream,
  id: number,
  status: number,
  body: unknown,
): Promise<void> {
  const message = { type: "api_response", id, status, body: JSON.stringify(body) };
  await stream.write_raw_and_finish(new TextEncoder().encode(JSON.stringify(message)));
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

export interface ApiRouterOptions {
  /** resolves `nodeId` (the verified peer identity of whoever opened the
   * current stream) to its `ApiPeerRole`, or `null`/`undefined` if the
   * peer isn't recognized at all. when omitted, every non-`"public"`
   * route is rejected outright (fail closed) - a host app must actively
   * wire this to open anything beyond its `"public"` routes up. */
  resolvePeerRole?: (
    nodeId: string,
  ) => Promise<ApiPeerRole | null | undefined> | ApiPeerRole | null | undefined;
}

export interface ApiRouter {
  registerRoute(method: string, path: string, handler: ApiRouteHandler, auth?: ApiRouteAuth): void;
  /** handle a single request/response round-trip on the `freqhole/1` ALPN. */
  dispatch(stream: CenotaphBiStream): Promise<void>;
}

export function createApiRouter(options: ApiRouterOptions = {}): ApiRouter {
  const routes = new Map<string, RegisteredRoute>();

  function registerRoute(
    method: string,
    path: string,
    handler: ApiRouteHandler,
    // mirrors grimoire's `RouteAuth::default()` ("safe default, routes
    // should explicitly set Public if needed") - "viewer" is the lowest
    // privilege level, i.e. any recognized peer at all.
    auth: ApiRouteAuth = "viewer",
  ): void {
    routes.set(routeKey(method, path), { handler, auth });
  }

  async function dispatch(stream: CenotaphBiStream): Promise<void> {
    // tracked outside the try so the catch block below can still respond
    // with a real error status instead of just dropping the stream, even
    // if the handler itself throws after this point.
    let requestId: number | undefined;
    try {
      const bytes = await stream.read_to_end(64 * 1024);
      // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
      console.log("[debug/apiRouter] dispatch read bytes:", bytes?.length ?? null);
      if (bytes === null) return;

      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!isApiRequestMessage(parsed)) {
        console.log("[debug/apiRouter] not an api_request message:", parsed);
        return;
      }
      requestId = parsed.id;

      const route = routes.get(routeKey(parsed.method, parsed.path));
      // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
      console.log(
        `[debug/apiRouter] dispatching ${parsed.method} ${parsed.path}, handler found: ${!!route}`,
      );
      if (!route) {
        await writeApiResponse(stream, parsed.id, 404, { error: "not found" });
        return;
      }

      if (route.auth !== "public") {
        const peerNodeId = stream.peer_node_id();
        const role = options.resolvePeerRole ? await options.resolvePeerRole(peerNodeId) : null;
        console.log(
          `[debug/apiRouter] ${parsed.method} ${parsed.path} role check for ${peerNodeId}: ${role ?? "none"} (needs >= ${route.auth})`,
        );
        if (!role) {
          await writeApiResponse(stream, parsed.id, 401, {
            error: "unauthorized: peer not registered",
          });
          return;
        }
        if (ROLE_LEVEL[role] > ROLE_LEVEL[route.auth]) {
          await writeApiResponse(stream, parsed.id, 403, {
            error: `forbidden: route requires role ${route.auth} or higher`,
          });
          return;
        }
      }

      const parsedBody: unknown = parsed.body ? JSON.parse(parsed.body) : null;
      // TEMP DEBUG - remove once sync-to-local wiring bug is found
      console.log(`[debug/apiRouter] ${parsed.method} ${parsed.path} body:`, parsedBody);
      const result = await route.handler(parsedBody);
      // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
      console.log(`[debug/apiRouter] handler result status=${result.status}`, result.body);
      await writeApiResponse(stream, parsed.id, result.status, result.body);
    } catch (err) {
      console.error("[cenotaph] api request handling failed:", err);
      // TEMP DEBUG - remove once sync-to-local wiring bug is found
      console.log(
        `[debug/apiRouter] handler threw, sending 500 instead of dropping the stream:`,
        err,
      );
      // previously this just fell through to `finally`'s `stream.close()`
      // with no response ever written - the caller saw a bare "connection
      // lost" with no way to tell a thrown exception from a real network
      // drop. if `requestId` never got set (e.g. the bytes/JSON itself
      // were malformed), there's no request to respond to - still just a
      // close in that case.
      if (requestId !== undefined) {
        try {
          await writeApiResponse(stream, requestId, 500, {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        } catch {
          // best-effort only - the stream may already be unusable.
        }
      }
    } finally {
      stream.close();
    }
  }

  return { registerRoute, dispatch };
}
