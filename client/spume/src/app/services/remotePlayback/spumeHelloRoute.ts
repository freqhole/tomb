// spume's own `GET /api/hello` content, served on the `freqhole/1` ALPN via
// cenotaph's `createApiRouter`/`createHelloRouteHandler` - answers the same
// probe spume's own "add remote" flow sends to every peer it's asked to
// add, so another spume/player.freqhole.net instance probing THIS spume
// instance sees `supports_remote_playback` reflect the user's current
// opt-in toggle (see remoteModeSettings.ts).

import type { HelloInfo } from "@freqhole/cenotaph";
import { getLocalLibraryName } from "../storage/db";
import { isRemotePlaybackEnabled } from "./remoteModeSettings";

export function getSpumeHelloInfo(): HelloInfo {
  const info: HelloInfo = {
    name: getLocalLibraryName(),
    description: "freqhole music player",
    version: "1",
    image_url: null,
    image_blob_id: null,
    knocking_enabled: false,
    player_device: true,
    supports_remote_playback: isRemotePlaybackEnabled(),
  };
  // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
  console.log("[debug/hello] getSpumeHelloInfo() called:", info);
  return info;
}
