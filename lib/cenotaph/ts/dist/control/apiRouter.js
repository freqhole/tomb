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
            const handler = routes.get(routeKey(parsed.method, parsed.path));
            // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
            console.log(`[debug/apiRouter] dispatching ${parsed.method} ${parsed.path}, handler found: ${!!handler}`);
            if (!handler) {
                await writeApiResponse(stream, parsed.id, 404, { error: "not found" });
                return;
            }
            const parsedBody = parsed.body ? JSON.parse(parsed.body) : null;
            const result = await handler(parsedBody);
            // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
            console.log(`[debug/apiRouter] handler result status=${result.status}`, result.body);
            await writeApiResponse(stream, parsed.id, result.status, result.body);
        }
        catch (err) {
            console.error("[cenotaph] api request handling failed:", err);
        }
        finally {
            stream.close();
        }
    }
    return { registerRoute, dispatch };
}
