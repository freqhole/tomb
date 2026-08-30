// mirrors grimoire/src/offal/music/songs.rs::query() - route-level glue
// (parse request, delegate, shape response) around crud/query.ts's
// querySongs(), the actual business logic.

import type { ApiRouteHandler } from "@freqhole/cenotaph";
import type { QueryParams } from "@freqhole/api-client";
import { querySongs } from "./crud/query";

export const query: ApiRouteHandler = async (body) => {
  const params = (body as Partial<QueryParams> | null) ?? {};
  const result = await querySongs(params);
  return { status: 200, body: result };
};
