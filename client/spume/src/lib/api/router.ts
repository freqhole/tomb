// browser-side mirror of grimoire's server/src/routes.rs (which iterates
// offal::all_routes() to build the real server's router): registers this
// package's route handlers - organized by domain the same way grimoire's
// own modules are (music/, media_blobz/, video/, ...) - onto a cenotaph
// `ApiRouter`. see docs/cenotaph-migration-plan.md phase 3, tier 2.

import type { ApiRouter } from "@freqhole/cenotaph";
import { query as querySongs } from "./music/songs";
import { getMetadata as blobMetadata } from "./media_blobz";
import { query as queryVideos } from "./video/videos";

export function registerBrowserApiRoutes(router: ApiRouter): void {
  router.registerRoute("POST", "/api/songs/query", querySongs);
  router.registerRoute("POST", "/api/blob_metadata", blobMetadata);
  router.registerRoute("POST", "/api/video/videos/query", queryVideos);
}
