// hand-rolled gossip types with proper discriminated union support
// the codegen doesn't handle rust's #[serde(tag = "ref_type")] properly yet
import { z } from "zod";
import {
  SongReferenceSchema,
  AlbumReferenceSchema,
  ArtistReferenceSchema,
  PlaylistReferenceSchema,
  GenreReferenceSchema,
  MusicSharePayloadSchema as _GeneratedMusicSharePayloadSchema,
} from "../codegen/schema.js";

// discriminated union for music references
// matches rust's MusicReference enum with #[serde(tag = "ref_type")]
export const MusicReferenceSchema = z.discriminatedUnion("ref_type", [
  SongReferenceSchema.extend({ ref_type: z.literal("Song") }),
  AlbumReferenceSchema.extend({ ref_type: z.literal("Album") }),
  ArtistReferenceSchema.extend({ ref_type: z.literal("Artist") }),
  PlaylistReferenceSchema.extend({ ref_type: z.literal("Playlist") }),
  GenreReferenceSchema.extend({ ref_type: z.literal("Genre") }),
]);

export type MusicReference = z.infer<typeof MusicReferenceSchema>;

// re-export MusicSharePayload with the proper MusicReference union
export const MusicSharePayloadSchema = z.object({
  text: z.string().nullable(),
  items: z.array(MusicReferenceSchema),
});

export type MusicSharePayload = z.infer<typeof MusicSharePayloadSchema>;

// re-export the individual reference types for convenience
export type SongReference = z.infer<typeof SongReferenceSchema> & { ref_type: "Song" };
export type AlbumReference = z.infer<typeof AlbumReferenceSchema> & { ref_type: "Album" };
export type ArtistReference = z.infer<typeof ArtistReferenceSchema> & { ref_type: "Artist" };
export type PlaylistReference = z.infer<typeof PlaylistReferenceSchema> & { ref_type: "Playlist" };
export type GenreReference = z.infer<typeof GenreReferenceSchema> & { ref_type: "Genre" };

export {
  MusicReferenceSchema as MusicReferenceDiscriminatedSchema,
  MusicSharePayloadSchema as MusicSharePayloadDiscriminatedSchema,
};
