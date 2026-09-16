// spume's own `GET /api/hello` content, served on the `freqhole/1` ALPN via
// cenotaph's `createApiRouter`/`createHelloRouteHandler` - answers the same
// probe spume's own "add remote" flow sends to every peer it's asked to
// add, so another spume/player.freqhole.net instance probing THIS spume
// instance sees `supports_remote_playback` reflect the user's current
// opt-in toggle (see remoteModeSettings.ts).

import type { HelloInfo } from "../index";
import { getLocalLibraryName } from "../../app/services/storage/db";
import { isActivePlayer, isRemotePlaybackEnabled } from "./remoteModeSettings";
import { debug } from "../../utils/logger";

export function getSpumeHelloInfo(): HelloInfo {
  const info: HelloInfo = {
    name: getLocalLibraryName(),
    description: "freqhole music player",
    version: "1",
    image_url: null,
    image_blob_id: null,
    knocking_enabled: false,
    // reflects whether /player is actually mounted right now, not just
    // whether the user has opted in (see remoteModeSettings.ts).
    player_device: isActivePlayer(),
    supports_remote_playback: isRemotePlaybackEnabled(),
  };
  debug("spumeHelloRoute", "getSpumeHelloInfo() called:", info);
  return info;
}
