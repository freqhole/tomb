// builds a `GET /api/hello` route handler for `control/apiRouter.ts` -
// answers "freqhole/1" api-request probes, the same probe spume's regular
// "add remote" flow sends to every peer it's asked to add
// (client.app.serverInfo() -> GET /api/hello).
//
// the route's *content* is host-app-specific (player.freqhole.net's own
// anonymous device name/description vs spume's own device name +
// remote-playback capability flag) - this module only knows the response
// shape, not which fields a given host app fills in or why.

export interface HelloInfo {
  name: string;
  description: string;
  version: string;
  image_url: string | null;
  image_blob_id: string | null;
  knocking_enabled: boolean;
  /** marks this peer as a player device (not a full remote-server
   * candidate) - lets spume's add-remote flow point the user at "pair a
   * player" instead of treating it as a dead-end remote-server candidate. */
  player_device?: boolean;
  /** advertises that this peer can also accept `freqhole-player/1`
   * pairing + control connections right now (e.g. spume's own opt-in
   * remote-playback-target toggle). */
  supports_remote_playback?: boolean;
}

export type HelloInfoProvider = () => HelloInfo | Promise<HelloInfo>;

export function createHelloRouteHandler(getInfo: HelloInfoProvider) {
  return async (): Promise<{ status: number; body: HelloInfo }> => {
    return { status: 200, body: await getInfo() };
  };
}
