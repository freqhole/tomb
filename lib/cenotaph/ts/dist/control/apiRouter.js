// generic freqhole/1 request/response router: generalizes what used to be
// a single hardcoded "GET /api/hello" branch into a real
// `registerRoute()` table, so future routes can be added without touching
// the wire-framing code here at all.
//
// the wire envelope (`api_request`/`api_response`, ndjson-free single
// request/response per stream) matches grimoire's own native federation
// transport and midden's dial-side `api_request()` client - see
// lib/midden/src/lib.rs.
function isApiRequestMessage(value) {
    return (!!value && typeof value === "object" && value.type === "api_request");
}
async function writeApiResponse(stream, id, status, body) {
    const message = { type: "api_response", id, status, body: JSON.stringify(body) };
    await stream.write_raw_and_finish(new TextEncoder().encode(JSON.stringify(message)));
}
function routeKey(method, path) {
    return `${method.toUpperCase()} ${path}`;
}
export function createApiRouter() {
    const routes = new Map();
    function registerRoute(method, path, handler) {
        routes.set(routeKey(method, path), handler);
    }
    async function dispatch(stream) {
        // tracked outside the try so the catch block below can still respond
        // with a real error status instead of just dropping the stream, even
        // if the handler itself throws after this point.
        let requestId;
        try {
            const bytes = await stream.read_to_end(64 * 1024);
            // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
            console.log("[debug/apiRouter] dispatch read bytes:", bytes?.length ?? null);
            if (bytes === null)
                return;
            const parsed = JSON.parse(new TextDecoder().decode(bytes));
            if (!isApiRequestMessage(parsed)) {
                console.log("[debug/apiRouter] not an api_request message:", parsed);
                return;
            }
            requestId = parsed.id;
            const handler = routes.get(routeKey(parsed.method, parsed.path));
            // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
            console.log(`[debug/apiRouter] dispatching ${parsed.method} ${parsed.path}, handler found: ${!!handler}`);
            if (!handler) {
                await writeApiResponse(stream, parsed.id, 404, { error: "not found" });
                return;
            }
            const parsedBody = parsed.body ? JSON.parse(parsed.body) : null;
            // TEMP DEBUG - remove once sync-to-local wiring bug is found
            console.log(`[debug/apiRouter] ${parsed.method} ${parsed.path} body:`, parsedBody);
            const result = await handler(parsedBody);
            // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
            console.log(`[debug/apiRouter] handler result status=${result.status}`, result.body);
            await writeApiResponse(stream, parsed.id, result.status, result.body);
        }
        catch (err) {
            console.error("[cenotaph] api request handling failed:", err);
            // TEMP DEBUG - remove once sync-to-local wiring bug is found
            console.log(`[debug/apiRouter] handler threw, sending 500 instead of dropping the stream:`, err);
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
                }
                catch {
                    // best-effort only - the stream may already be unusable.
                }
            }
        }
        finally {
            stream.close();
        }
    }
    return { registerRoute, dispatch };
}
