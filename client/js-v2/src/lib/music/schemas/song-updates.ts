import { z } from "zod";
import { SongSchema } from "./song.js";
import { SongMetadataFieldsSchema } from "./form-schemas.js";

export const BulkTagOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("Replace"),
    tags: z.array(z.string()),
  }),
  z.object({
    type: z.literal("Add"),
    tags: z.array(z.string()),
  }),
  z.object({
    type: z.literal("Remove"),
    tags: z.array(z.string()),
  }),
]);

export const BulkSongUpdatesSchema = z.object({
  tags: BulkTagOperationSchema.optional(),
  // add metadata updates - all fields optional for partial updates
  ...Object.fromEntries(
    Object.entries(SongMetadataFieldsSchema.shape).map(([key, schema]) => [
      key,
      schema.optional(),
    ])
  ),
});

export const BulkUpdateSongsRequestSchema = z.object({
  song_ids: z.array(z.string().uuid()),
  updates: BulkSongUpdatesSchema,
});

export const TagOperationSummarySchema = z.object({
  operation_type: z.string(),
  tags_affected: z.array(z.string()),
  songs_modified: z.number(),
});

export const BulkOperationSummarySchema = z.object({
  total_songs: z.number(),
  successful_updates: z.number(),
  failed_updates: z.number(),
  tag_operations: TagOperationSummarySchema.nullable().optional(),
});

export const BulkUpdateSongsResponseSchema = z.object({
  message: z.string(),
  updated_songs: z.array(SongSchema),
  operations_summary: BulkOperationSummarySchema,
});

// Export types
export type BulkTagOperation = z.infer<typeof BulkTagOperationSchema>;
export type BulkSongUpdates = z.infer<typeof BulkSongUpdatesSchema>;
export type BulkUpdateSongsRequest = z.infer<
  typeof BulkUpdateSongsRequestSchema
>;
export type TagOperationSummary = z.infer<typeof TagOperationSummarySchema>;
export type BulkOperationSummary = z.infer<typeof BulkOperationSummarySchema>;
export type BulkUpdateSongsResponse = z.infer<
  typeof BulkUpdateSongsResponseSchema
>;
