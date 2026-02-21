// hand-rolled favorites types with proper discriminated union support
// the codegen doesn't handle rust's #[serde(tag = "type")] properly yet
import { z } from "zod";
import {
  SongQueryResultSchema,
  AlbumQueryResultSchema,
  ArtistQueryResultSchema,
  PlaylistQueryResultSchema,
} from "./codegen/schema.js";

// discriminated union for favorite items
// matches rust's FavoriteItem enum with #[serde(tag = "type", rename_all = "lowercase")]
const FavoriteItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("song"),
    favorited_at: z.number(),
    song: SongQueryResultSchema,
  }),
  z.object({
    type: z.literal("album"),
    favorited_at: z.number(),
    album: AlbumQueryResultSchema,
  }),
  z.object({
    type: z.literal("artist"),
    favorited_at: z.number(),
    artist: ArtistQueryResultSchema,
  }),
  z.object({
    type: z.literal("playlist"),
    favorited_at: z.number(),
    playlist: PlaylistQueryResultSchema,
  }),
]);

export type FavoriteItem = z.infer<typeof FavoriteItemSchema>;

// properly typed response from list_favorites endpoint
const ListFavoritesResponseSchema = z.object({
  favorites: z.array(FavoriteItemSchema),
  total_count: z.number(),
  has_more: z.boolean(),
  offset: z.number(),
  limit: z.number(),
});

export type ListFavoritesResponse = z.infer<
  typeof ListFavoritesResponseSchema
>;

// export schemas for runtime validation if needed
export { FavoriteItemSchema, ListFavoritesResponseSchema };
