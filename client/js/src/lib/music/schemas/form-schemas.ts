import { z } from "zod";
import { SongSchema } from "./song.js";

// extract editable metadata fields from song schema
export const SongMetadataFieldsSchema = SongSchema.pick({
  title: true,
  artist: true,
  album: true,
  album_artist: true,
  track_number: true,
  disc_number: true,
  genre: true,
  year: true,
  bpm: true,
  key_signature: true,
  thumbnail_blob_id: true,
});

export type SongMetadataFields = z.infer<typeof SongMetadataFieldsSchema>;

// extract user preference fields from song schema
export const SongUserPreferenceFieldsSchema = SongSchema.pick({
  user_rating: true,
  user_is_favorite: true,
});

export type SongUserPreferenceFields = z.infer<
  typeof SongUserPreferenceFieldsSchema
>;

// combined editable fields
export const EditableSongFieldsSchema = SongMetadataFieldsSchema.merge(
  SongUserPreferenceFieldsSchema
);

export type EditableSongFields = z.infer<typeof EditableSongFieldsSchema>;

// form field configuration with metadata
export const FormFieldConfig = {
  // metadata fields (admin-only)
  metadata: {
    title: { label: "title", type: "text" as const, required: true },
    artist: { label: "artist", type: "text" as const },
    album: { label: "album", type: "text" as const },
    album_artist: { label: "album artist", type: "text" as const },
    track_number: { label: "track number", type: "number" as const },
    disc_number: { label: "disc number", type: "number" as const },
    genre: { label: "genre", type: "text" as const },
    year: { label: "year", type: "number" as const },
    bpm: { label: "bpm", type: "number" as const },
    key_signature: { label: "key signature", type: "text" as const },
    thumbnail_blob_id: { label: "thumbnail image", type: "image" as const },
  },
  // user preference fields
  userPreferences: {
    user_rating: { label: "rating", type: "rating" as const },
    user_is_favorite: { label: "favorite", type: "favorite" as const },
  },
} as const;

// helper to get field categories
export const getMetadataFieldKeys = () =>
  Object.keys(FormFieldConfig.metadata) as Array<keyof SongMetadataFields>;

export const getUserPreferenceFieldKeys = () =>
  Object.keys(FormFieldConfig.userPreferences) as Array<
    keyof SongUserPreferenceFields
  >;

export const getAllEditableFieldKeys = () =>
  [...getMetadataFieldKeys(), ...getUserPreferenceFieldKeys()] as Array<
    keyof EditableSongFields
  >;

// helper to check if field is metadata or user preference
export const isMetadataField = (field: keyof EditableSongFields): boolean => {
  return field in FormFieldConfig.metadata;
};

export const isUserPreferenceField = (
  field: keyof EditableSongFields
): boolean => {
  return field in FormFieldConfig.userPreferences;
};

// helper to get field configuration
export const getFieldConfig = (field: keyof EditableSongFields) => {
  if (field in FormFieldConfig.metadata) {
    return FormFieldConfig.metadata[
      field as keyof typeof FormFieldConfig.metadata
    ];
  }
  if (field in FormFieldConfig.userPreferences) {
    return FormFieldConfig.userPreferences[
      field as keyof typeof FormFieldConfig.userPreferences
    ];
  }
  throw new Error(`no configuration found for field: ${field}`);
};
