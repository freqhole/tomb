// builds a `GET /api/hello` route handler for `control/apiRouter.ts` -
// answers "freqhole/1" api-request probes, the same probe spume's regular
// "add remote" flow sends to every peer it's asked to add
// (client.app.serverInfo() -> GET /api/hello).
//
// the route's *content* is host-app-specific (player.freqhole.net's own
// anonymous device name/description vs spume's own device name +
// remote-playback capability flag) - this module only knows the response
// shape, not which fields a given host app fills in or why.
export function createHelloRouteHandler(getInfo) {
    return async () => {
        return { status: 200, body: await getInfo() };
    };
}
