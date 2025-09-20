import { createSignal, createMemo } from "solid-js";

import type { Song } from "../../lib/music/schemas/song.js";
import {
  EditableSongFieldsSchema,
  type EditableSongFields,
} from "../../lib/music/schemas/form-schemas.js";

interface FormStoreOptions {
  onSubmit?: (changes: Partial<EditableSongFields>) => Promise<void>;
  validateField?: (key: keyof EditableSongFields, value: any) => string | null;
}

export function useSongFormStore(
  initialSong: Song | Song[], // support both single and bulk editing
  options: FormStoreOptions = {}
) {
  // extract editable fields from song(s)
  const extractEditableFields = (song: Song): EditableSongFields => {
    return EditableSongFieldsSchema.parse({
      title: song.title,
      artist: song.artist,
      album: song.album,
      album_artist: song.album_artist,
      track_number: song.track_number,
      disc_number: song.disc_number,
      genre: song.genre,
      year: song.year,
      bpm: song.bpm,
      key_signature: song.key_signature,
      user_rating: song.user_rating,
      user_is_favorite: song.user_is_favorite,
    });
  };

  // handle mixed values for bulk editing
  const getMixedOrValue = <T>(values: T[]): T | "mixed" => {
    const unique = [...new Set(values)];
    return unique.length === 1 ? unique[0]! : ("mixed" as T | "mixed");
  };

  const songs = Array.isArray(initialSong) ? initialSong : [initialSong];
  const isBulkMode = Array.isArray(initialSong);

  // initialize form data
  const initializeFormData = (): EditableSongFields & {
    [K in keyof EditableSongFields]: EditableSongFields[K] | "mixed";
  } => {
    if (!isBulkMode && songs[0]) {
      return extractEditableFields(songs[0]);
    }

    // bulk mode: compute mixed values
    const allFields = songs.map(extractEditableFields);
    const result: any = {};

    (
      Object.keys(EditableSongFieldsSchema.shape) as Array<
        keyof EditableSongFields
      >
    ).forEach((key) => {
      const values = allFields.map((fields) => fields[key]);
      result[key] = getMixedOrValue(values);
    });

    return result;
  };

  const [originalData] = createSignal(initializeFormData());
  const [currentData, setCurrentData] = createSignal(initializeFormData());

  // computed values using schema keys
  const changes = createMemo(() => {
    const orig = originalData();
    const curr = currentData();
    const result: Partial<EditableSongFields> = {};

    (
      Object.keys(EditableSongFieldsSchema.shape) as Array<
        keyof EditableSongFields
      >
    ).forEach((key) => {
      if (orig[key] !== curr[key]) {
        // don't include "mixed" values in changes
        if (curr[key] !== "mixed") {
          result[key] = curr[key] as any;
        }
      }
    });

    return result;
  });

  const isDirty = createMemo(() => Object.keys(changes()).length > 0);

  const isFieldDirty = (field: keyof EditableSongFields): boolean => {
    return field in changes();
  };

  // type-safe field updates
  const updateField = <K extends keyof EditableSongFields>(
    field: K,
    value: EditableSongFields[K] | null
  ) => {
    setCurrentData((prev) => ({ ...prev, [field]: value }));
  };

  const resetField = (field: keyof EditableSongFields) => {
    const originalValue = originalData()[field];
    updateField(field, originalValue as any);
  };

  const resetAll = () => {
    setCurrentData(originalData());
  };

  return {
    // data
    songs,
    isBulkMode,
    originalData,
    currentData,
    changes,

    // state
    isDirty,
    isFieldDirty,

    // actions
    updateField,
    resetField,
    resetAll,
    submit: () => options.onSubmit?.(changes()),

    // helpers
    getDisplayValue: (field: keyof EditableSongFields) => {
      const value = currentData()[field];
      return value === "mixed" ? "" : (value ?? "");
    },
    getPlaceholder: (field: keyof EditableSongFields) => {
      const originalValue = originalData()[field];
      return originalValue === "mixed" ? "mixed values" : "";
    },
  };
}
