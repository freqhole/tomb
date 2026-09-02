// mirrors grimoire/src/offal/video/videos.rs::query() - route-level glue
// (parse request, delegate, shape response) around crud/query.ts's
// queryVideos(), the actual business logic.

import type { ApiRouteHandler } from "@freqhole/cenotaph";
import type { QueryVideosRequest } from "@freqhole/api-client";
import { queryVideos } from "./crud/query";

export const query: ApiRouteHandler = async (body) => {
  const request = (body as Partial<QueryVideosRequest> | null) ?? {};
  const result = await queryVideos(request);
  return { status: 200, body: result };
};
