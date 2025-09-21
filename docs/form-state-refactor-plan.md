# Form State Management Refactor Plan (Revised)

## critical rules - never forget

1. **no emojis**: keep code comments, logs, and ui display text lowercase (proper nouns and acronyms can be uppercase)
2. **file size limit**: maximum ~500 lines per file
3. **dark theme design**: ui must use dark theme with primary colors black, white, and magenta accents. use other colors sparingly. avoid borders and no rounded corner border radius (border-radius: 0)
4. **modular architecture**: use solidjs hooks for reactive logic, leverage createresource/produce/mutate for optimal reactivity, keep components presentational, central context providers for state, avoid prop drilling
5. **data validation**: use zod for all json api data parsing and validation (existing pattern)
6. **code reuse**: leverage existing lib code and hooks where possible, build new generic utilities in `client/js/src/lib/`
7. **domain separation**: keep admin logic generic in views/admin/, music-specific code in lib/music/ and hooks/music/
8. **generic library focus**: build reusable patterns in `client/js/src/lib/`
9. **legacy code marking**: when implementing new better patterns, clearly mark old code as `@deprecated`, `// LEGACY:`, or `// TODO: migrate to X` so we know which system to use and can clean up later. this prevents confusion between "this is broken and needs debugging now" vs "this works but should be migrated as part of the plan"

## Current Issues Analysis

After reviewing the git diff, several critical problems have been identified with the current form state implementation:

### 1. Complex Manual Dirty Field Tracking

- Both `SongEditForm` and `SongBulkEditForm` manually track dirty fields using `Set<string>`
- Inconsistent approaches between single and bulk edit forms
- Race conditions between local input state and reactive signals
- Form changes not properly propagating to parent components

### 2. Empty API Payloads

- Network requests show `updates: {}` because dirty field tracking is failing
- Parent components receive inconsistent or empty form data
- Manual field-by-field checking creates brittle code paths

### 3. Reactive System Conflicts

- Fighting against SolidJS reactivity with manual DOM manipulation
- Input refs mixed with reactive signals causing focus loss
- Premature optimistic updates interfere with form editing

### 4. Poor User Experience

- No visual feedback for edited fields
- No way to reset individual fields to original values
- Complex UI state makes debugging difficult

## Proposed Solution: Schema-Driven Reactive Form Store

### Core Concept

Replace manual dirty tracking with a **schema-driven reactive form store** that uses Zod schemas for type safety and automatically computes changes by comparing current values against original values.

### Key Principles

1. **Schema-First Design**: Use Zod schemas to define editable fields and their types
2. **Single Source of Truth**: One reactive store per form
3. **Computed Dirty State**: Automatically determine what changed
4. **Type Safety**: Full TypeScript type checking with Zod inference
5. **Visual Feedback**: Reactive CSS classes for edited fields
6. **Reset Functionality**: Individual field reset buttons
7. **Delayed Optimistic Updates**: Only update UI after successful API calls

## Implementation Plan

### Phase 1: Schema Architecture

#### 1.1 Create Editable Field Schemas

```typescript
// lib/music/schemas/form-schemas.ts
import { z } from "zod";
import { SongSchema } from "./song.js";

// Extract editable metadata fields from Song schema
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
});

export type SongMetadataFields = z.infer<typeof SongMetadataFieldsSchema>;

// Extract user preference fields from Song schema
export const SongUserPreferenceFieldsSchema = SongSchema.pick({
  user_rating: true,
  user_is_favorite: true,
});

export type SongUserPreferenceFields = z.infer<
  typeof SongUserPreferenceFieldsSchema
>;

// Combined editable fields
export const EditableSongFieldsSchema = SongMetadataFieldsSchema.merge(
  SongUserPreferenceFieldsSchema,
);

export type EditableSongFields = z.infer<typeof EditableSongFieldsSchema>;

// Form field configuration with metadata
export const FormFieldConfig = {
  // Metadata fields (admin-only)
  metadata: {
    title: { label: "Title", type: "text" as const, required: true },
    artist: { label: "Artist", type: "text" as const },
    album: { label: "Album", type: "text" as const },
    album_artist: { label: "Album Artist", type: "text" as const },
    track_number: { label: "Track Number", type: "number" as const },
    disc_number: { label: "Disc Number", type: "number" as const },
    genre: { label: "Genre", type: "text" as const },
    year: { label: "Year", type: "number" as const },
    bpm: { label: "BPM", type: "number" as const },
    key_signature: { label: "Key Signature", type: "text" as const },
  },
  // User preference fields
  userPreferences: {
    user_rating: { label: "Rating", type: "rating" as const },
    user_is_favorite: { label: "Favorite", type: "favorite" as const },
  },
} as const;

// Helper to get field categories
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
```

#### 1.2 Update Bulk Updates Schema

```typescript
// lib/music/schemas/song-updates.ts (extend existing)
import { SongMetadataFieldsSchema } from "./form-schemas.js";

// Make BulkSongUpdatesSchema support all metadata fields
export const BulkSongUpdatesSchema = z.object({
  // Existing tag operations
  tags: BulkTagOperationSchema.optional(),
  // Add metadata updates - all fields optional for partial updates
  ...Object.fromEntries(
    Object.entries(SongMetadataFieldsSchema.shape).map(([key, schema]) => [
      key,
      schema.optional(),
    ]),
  ),
});
```

#### 1.3 Schema-Driven Form Store Hook

```typescript
// hooks/forms/useFormStore.ts
import { createSignal, createMemo } from "solid-js";
import { z } from "zod";
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
  initialSong: Song | Song[], // Support both single and bulk editing
  options: FormStoreOptions = {},
) {
  // Extract editable fields from song(s)
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

  // Handle mixed values for bulk editing
  const getMixedOrValue = <T>(values: T[]): T | "mixed" => {
    const unique = [...new Set(values)];
    return unique.length === 1 ? unique[0] : ("mixed" as T | "mixed");
  };

  const songs = Array.isArray(initialSong) ? initialSong : [initialSong];
  const isBulkMode = Array.isArray(initialSong);

  // Initialize form data
  const initializeFormData = (): EditableSongFields & {
    [K in keyof EditableSongFields]: EditableSongFields[K] | "mixed";
  } => {
    if (!isBulkMode) {
      return extractEditableFields(songs[0]);
    }

    // Bulk mode: compute mixed values
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

  // Computed values using schema keys
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
        // Don't include "mixed" values in changes
        if (curr[key] !== "mixed") {
          result[key] = curr[key];
        }
      }
    });

    return result;
  });

  const isDirty = createMemo(() => Object.keys(changes()).length > 0);

  const isFieldDirty = (field: keyof EditableSongFields): boolean => {
    return field in changes();
  };

  // Type-safe field updates
  const updateField = <K extends keyof EditableSongFields>(
    field: K,
    value: EditableSongFields[K] | null,
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
    // Data
    songs,
    isBulkMode,
    originalData,
    currentData,
    changes,

    // State
    isDirty,
    isFieldDirty,

    // Actions
    updateField,
    resetField,
    resetAll,
    submit: () => options.onSubmit?.(changes()),

    // Helpers
    getDisplayValue: (field: keyof EditableSongFields) => {
      const value = currentData()[field];
      return value === "mixed" ? "" : (value ?? "");
    },
    getPlaceholder: (field: keyof EditableSongFields) => {
      const originalValue = originalData()[field];
      return originalValue === "mixed" ? "Mixed values" : "";
    },
  };
}
```

### Phase 2: Enhanced Form Components

#### 2.1 Schema-Driven Form Field Component

```typescript
// components/forms/SongFormField.tsx
import { Show } from "solid-js";
import { FormFieldConfig, type EditableSongFields } from "../../lib/music/schemas/form-schemas.js";

interface SongFormFieldProps {
  field: keyof EditableSongFields;
  value: any;
  placeholder?: string;
  isDirty: boolean;
  disabled?: boolean;
  onUpdate: (value: any) => void;
  onReset: () => void;
}

export function SongFormField(props: SongFormFieldProps) {
  // Get field configuration from schema
  const getFieldConfig = () => {
    const metadataConfig = FormFieldConfig.metadata[props.field as keyof typeof FormFieldConfig.metadata];
    const userPrefConfig = FormFieldConfig.userPreferences[props.field as keyof typeof FormFieldConfig.userPreferences];
    return metadataConfig || userPrefConfig;
  };

  const config = getFieldConfig();

  if (!config) {
    throw new Error(`No configuration found for field: ${props.field}`);
  }

  // critical: use refs to prevent focus loss during reactive updates
  let inputRef: HTMLInputElement | undefined;

  // set initial value and handle updates manually to prevent focus loss
  onMount(() => {
    if (inputRef) {
      inputRef.value = props.value || "";
    }
  });

  // only update input value if it actually changed and input is not focused
  createEffect(() => {
    if (inputRef && document.activeElement !== inputRef) {
      const newValue = props.value || "";
      if (inputRef.value !== newValue) {
        inputRef.value = newValue;
      }
    }
  });

  const handleInput = (e: Event) => {
    const target = e.currentTarget as HTMLInputElement;
    const value = target.value;

    let processedValue: any;
    if (config.type === "number") {
      processedValue = value === "" ? null : parseInt(value, 10);
    } else {
      processedValue = value === "" ? null : value;
    }

    props.onUpdate(processedValue);
  };

  const renderInput = () => {
    switch (config.type) {
      case "text":
      case "number":
        return (
          <input
            ref={(el) => { inputRef = el; }}
            type={config.type}
            placeholder={props.placeholder}
            disabled={props.disabled}
            data-field={props.field}
            class={`
              w-full px-3 py-2 bg-gray-800 border text-white placeholder-gray-500
              transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-magenta-500
              ${props.isDirty
                ? 'border-magenta-500 bg-magenta-900/10'
                : 'border-gray-600 focus:border-magenta-500'
              }
              ${props.disabled ? 'opacity-50 cursor-not-allowed' : ''}
            `}
            onInput={handleInput}
          />
        );

      case "rating":
        return (
          <div class="text-sm text-gray-400">
            {/* TODO: Integrate SongStarRatingCompact component */}
            Rating component placeholder (current: {props.value})
          </div>
        );

      case "favorite":
        return (
          <div class="text-sm text-gray-400">
            {/* TODO: Integrate SongFavoriteHeart component */}
            Favorite component placeholder (current: {String(props.value)})
          </div>
        );

      default:
        return <div class="text-red-500">unknown field type: {config.type}</div>;
    }
  };

  return (
    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <label class="block text-sm font-medium text-gray-300">
          {config.label}
          {config.required && <span class="text-red-400 ml-1">*</span>}
        </label>
        <Show when={props.isDirty && !props.disabled}>
          <button
            type="button"
            onClick={props.onReset}
            class="text-xs text-gray-400 hover:text-magenta-400 transition-colors px-2 py-1 rounded hover:bg-gray-700"
            title="Reset to original value"
          >
            reset
          </button>
        </Show>
      </div>

      {renderInput()}
    </div>
  );
}
```

#### 2.2 Simplified SongEditForm

```typescript
// components/songs/SongEditForm.tsx
import { createEffect, For } from "solid-js";
import { useSongFormStore } from "../../hooks/forms/useFormStore.js";
import { SongFormField } from "../forms/SongFormField.js";
import { FormFieldConfig, getAllEditableFieldKeys } from "../../lib/music/schemas/form-schemas.js";
import type { Song } from "../../lib/music/schemas/song.js";

interface SongEditFormProps {
  song: Song;
  onFormChange: (changes: any) => void;
}

export function SongEditForm(props: SongEditFormProps) {
  const formStore = useSongFormStore(props.song);

  // Automatically notify parent when changes occur
  createEffect(() => {
    props.onFormChange(formStore.changes());
  });

  // Update form when song prop changes
  createEffect(() => {
    // Could reset form here if needed, but typically single edit forms don't change songs
  });

  const allFields = getAllEditableFieldKeys();

  return (
    <div class="space-y-6">
      {/* Song info header */}
      <div class="bg-gray-800/50 p-4 border border-gray-700 rounded-lg">
        <div class="font-medium text-white mb-1">
          editing: {props.song.title || 'untitled'}
        </div>
        <div class="text-sm text-gray-400">
          {props.song.artist && `${props.song.artist} • `}
          {props.song.album || 'no album'}
          {props.song.year && ` • ${props.song.year}`}
        </div>

        {formStore.isDirty() && (
          <div class="text-xs text-magenta-400 mt-2 flex items-center gap-2">
            <div class="w-2 h-2 bg-magenta-500"></div>
            {Object.keys(formStore.changes()).length} field(s) modified
          </div>
        )}
      </div>

      {/* Metadata fields */}
      <div class="space-y-4">
        <h3 class="text-lg font-medium text-gray-200 border-b border-gray-700 pb-2">
          song metadata
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <For each={Object.keys(FormFieldConfig.metadata) as Array<keyof typeof FormFieldConfig.metadata>}>
            {(field) => (
              <SongFormField
                field={field}
                value={formStore.getDisplayValue(field)}
                placeholder={formStore.getPlaceholder(field)}
                isDirty={formStore.isFieldDirty(field)}
                onUpdate={(value) => formStore.updateField(field, value)}
                onReset={() => formStore.resetField(field)}
              />
            )}
          </For>
        </div>
      </div>

      {/* User preference fields */}
      <div class="space-y-4">
        <h3 class="text-lg font-medium text-gray-200 border-b border-gray-700 pb-2">
          personal preferences
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <For each={Object.keys(FormFieldConfig.userPreferences) as Array<keyof typeof FormFieldConfig.userPreferences>}>
            {(field) => (
              <SongFormField
                field={field}
                value={formStore.getDisplayValue(field)}
                placeholder={formStore.getPlaceholder(field)}
                isDirty={formStore.isFieldDirty(field)}
                onUpdate={(value) => formStore.updateField(field, value)}
                onReset={() => formStore.resetField(field)}
              />
            )}
          </For>
        </div>
      </div>

      {/* Form actions */}
      {formStore.isDirty() && (
        <div class="flex justify-end gap-2 pt-4 border-t border-gray-700">
          <button
            type="button"
            onClick={() => formStore.resetAll()}
            class="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
          >
            reset all changes
          </button>
        </div>
      )}
    </div>
  );
}
```

#### 2.3 Simplified SongBulkEditForm

```typescript
// components/songs/SongBulkEditForm.tsx
import { createEffect, For } from "solid-js";
import { useSongFormStore } from "../../hooks/forms/useFormStore.js";
import { SongFormField } from "../forms/SongFormField.js";
import { FormFieldConfig } from "../../lib/music/schemas/form-schemas.js";
import type { Song } from "../../lib/music/schemas/song.js";

interface SongBulkEditFormProps {
  songs: Song[];
  onFormChange: (changes: any) => void;
}

export function SongBulkEditForm(props: SongBulkEditFormProps) {
  const formStore = useSongFormStore(props.songs); // Pass array for bulk mode

  // Only send changes to parent (not the full mixed state)
  createEffect(() => {
    props.onFormChange(formStore.changes());
  });

  return (
    <div class="space-y-6">
      {/* Bulk edit header */}
      <div class="bg-gray-800/50 p-4 border border-gray-700 rounded-lg">
        <div class="font-medium text-white mb-1">
          bulk editing: {props.songs.length} songs
        </div>
        <div class="text-sm text-gray-400">
          fields showing "mixed values" contain different values across selected songs
        </div>

        {formStore.isDirty() && (
          <div class="text-xs text-magenta-400 mt-2 flex items-center gap-2">
            <div class="w-2 h-2 bg-magenta-500"></div>
            {Object.keys(formStore.changes()).length} field(s) will be updated across all songs
          </div>
        )}
      </div>

      {/* Metadata fields */}
      <div class="space-y-4">
        <h3 class="text-lg font-medium text-gray-200 border-b border-gray-700 pb-2">
          song metadata
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <For each={Object.keys(FormFieldConfig.metadata) as Array<keyof typeof FormFieldConfig.metadata>}>
            {(field) => (
              <SongFormField
                field={field}
                value={formStore.getDisplayValue(field)}
                placeholder={formStore.getPlaceholder(field)}
                isDirty={formStore.isFieldDirty(field)}
                onUpdate={(value) => formStore.updateField(field, value)}
                onReset={() => formStore.resetField(field)}
              />
            )}
          </For>
        </div>
      </div>

      {/* User preference fields */}
      <div class="space-y-4">
        <h3 class="text-lg font-medium text-gray-200 border-b border-gray-700 pb-2">
          personal preferences
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <For each={Object.keys(FormFieldConfig.userPreferences) as Array<keyof typeof FormFieldConfig.userPreferences>}>
            {(field) => (
              <SongFormField
                field={field}
                value={formStore.getDisplayValue(field)}
                placeholder={formStore.getPlaceholder(field)}
                isDirty={formStore.isFieldDirty(field)}
                onUpdate={(value) => formStore.updateField(field, value)}
                onReset={() => formStore.resetField(field)}
              />
            )}
          </For>
        </div>
      </div>

      {/* Form actions */}
      {formStore.isDirty() && (
        <div class="flex justify-end gap-2 pt-4 border-t border-gray-700">
          <button
            type="button"
            onClick={() => formStore.resetAll()}
            class="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors"
          >
            reset all changes
          </button>
        </div>
      )}
    </div>
  );
}
```

### Phase 3: Schema-Driven API Integration

#### 3.1 Enhanced API Client Methods

```typescript
// lib/api-client.ts - Enhanced methods using schema validation
import {
  getMetadataFieldKeys,
  getUserPreferenceFieldKeys,
  type EditableSongFields,
} from "./music/schemas/form-schemas.js";

class ApiClient {
  // ... existing methods

  async bulkUpdateSongs(request: {
    song_ids: string[];
    updates: Partial<EditableSongFields>;
  }) {
    // Automatically separate metadata from user preferences using schema
    const metadataFields = new Set(getMetadataFieldKeys());
    const userPrefFields = new Set(getUserPreferenceFieldKeys());

    const metadataUpdates = Object.fromEntries(
      Object.entries(request.updates).filter(([key]) =>
        metadataFields.has(key as any),
      ),
    );

    const userPrefUpdates = Object.fromEntries(
      Object.entries(request.updates).filter(([key]) =>
        userPrefFields.has(key as any),
      ),
    );

    // Filter out undefined/null values to create clean payloads
    const cleanMetadataUpdates = Object.fromEntries(
      Object.entries(metadataUpdates).filter(
        ([_, value]) => value !== undefined,
      ),
    );

    if (Object.keys(cleanMetadataUpdates).length === 0) {
      throw new Error("No metadata updates provided");
    }

    console.log("API: bulkUpdateSongs payload:", {
      song_ids: request.song_ids,
      updates: cleanMetadataUpdates,
    });

    return musicAdminApiMethods.bulkUpdateSongs.call(this, {
      song_ids: request.song_ids,
      updates: cleanMetadataUpdates,
    });
  }

  async bulkUpdateUserPreferences(request: {
    song_ids: string[];
    updates: Partial<EditableSongFields>;
  }) {
    // Automatically extract user preference fields using schema
    const userPrefFields = new Set(getUserPreferenceFieldKeys());

    const userPrefUpdates = Object.fromEntries(
      Object.entries(request.updates)
        .filter(([key]) => userPrefFields.has(key as any))
        .filter(([_, value]) => value !== undefined),
    );

    if (Object.keys(userPrefUpdates).length === 0) {
      throw new Error("No user preference updates provided");
    }

    console.log("API: bulkUpdateUserPreferences payload:", {
      song_ids: request.song_ids,
      updates: userPrefUpdates,
    });

    return musicApiMethods.bulkUpdateUserPreferences.call(this, {
      song_ids: request.song_ids,
      updates: userPrefUpdates,
    });
  }
}
```

#### 3.2 Schema-Driven SongInfoModal Save Logic

```typescript
// components/modals/SongInfoModal.tsx - Updated save logic
import {
  getMetadataFieldKeys,
  getUserPreferenceFieldKeys,
} from "../../lib/music/schemas/form-schemas.js";

const handleSave = async () => {
  try {
    setIsLoading(true);
    setError(null);

    const changes = formData();

    if (Object.keys(changes).length === 0) {
      console.log("no changes to save");
      props.onClose();
      return;
    }

    const songIds = props.songs.map((s) => s.id);

    // Use schema-driven field categorization
    const metadataFieldKeys = new Set(getMetadataFieldKeys());
    const userPrefFieldKeys = new Set(getUserPreferenceFieldKeys());

    const metadataUpdates = Object.fromEntries(
      Object.entries(changes).filter(([key]) =>
        metadataFieldKeys.has(key as any),
      ),
    );

    const userPrefUpdates = Object.fromEntries(
      Object.entries(changes).filter(([key]) =>
        userPrefFieldKeys.has(key as any),
      ),
    );

    const promises = [];

    // Admin metadata updates
    if (Object.keys(metadataUpdates).length > 0 && auth.isAdmin) {
      promises.push(
        apiClient.bulkUpdateSongs({
          song_ids: songIds,
          updates: metadataUpdates,
        }),
      );
    }

    // User preference updates
    if (Object.keys(userPrefUpdates).length > 0) {
      promises.push(
        apiClient.bulkUpdateUserPreferences({
          song_ids: songIds,
          updates: userPrefUpdates,
        }),
      );
    }

    if (promises.length > 0) {
      await Promise.all(promises);
    }

    // success feedback
    events.emit("notification:show", {
      message: `updated ${totalSongs()} song(s)`,
      type: "success",
    });

    // Refresh data (no optimistic updates during form editing)
    events.emit("data:reload", { type: "songs" });

    props.onClose();
  } catch (err) {
    console.error("save failed:", err);
    setError(err instanceof Error ? err.message : "failed to save changes");
  } finally {
    setIsLoading(false);
  }
};
```

### Phase 4: Enhanced User Experience

#### 4.1 Schema-Driven Visual Feedback System

- **Magenta borders**: Automatically applied to any dirty field using schema-driven field detection
- **Animated glow**: Pulsing effect for actively edited fields
- **Individual reset buttons**: Generated for each field that supports it
- **Change counter**: Real-time count of modified fields using schema keys
- **Field validation**: Schema-based validation with proper error messages

#### 4.2 Enhanced Field Components

- **rating component**: schema-aware star rating with proper change tracking
- **favorite toggle**: schema-aware heart toggle with visual feedback
- **text fields**: auto-formatting based on schema field types
- **number fields**: proper numeric validation and null handling

#### 4.3 Input Focus Handling Rules

**critical: prevent focus loss during reactive updates**

from analyzing the current failing implementation, the key rules are:

1. **use refs for input management**: never bind input `value` reactively - use `ref` and manual updates
2. **check focus before updating**: only update input value if `document.activeElement !== inputRef`
3. **compare before setting**: only set `inputRef.value` if it actually differs from current value
4. **set initial in onmount**: use `onMount()` to set initial values, not reactive effects
5. **use data attributes**: add `data-field={props.field}` for debugging and field identification
6. **manual dom updates**: avoid reactive signals for actively edited input values

```typescript
// correct pattern from failing implementation analysis:
let inputRef: HTMLInputElement | undefined;

onMount(() => {
  if (inputRef) {
    inputRef.value = props.value || "";
  }
});

// only update if not focused and value actually changed
createEffect(() => {
  if (inputRef && document.activeElement !== inputRef) {
    const newValue = props.value || "";
    if (inputRef.value !== newValue) {
      inputRef.value = newValue;
    }
  }
});
```

### Phase 5: Testing Strategy

#### 5.1 Schema Validation Tests

- Test that all song fields are properly categorized
- Verify schema inference works correctly
- Test mixed value computation in bulk mode
- Validate field type conversions

#### 5.2 Form Store Tests

- Test change detection with schema fields
- Test field reset functionality
- Test bulk vs single mode behavior
- Test TypeScript type safety

#### 5.3 API Integration Tests

- Test automatic payload construction
- Test field categorization for API calls
- Test error handling for invalid schemas
- Test empty payload prevention

## Implementation Timeline

### Week 1: Schema Infrastructure

- Create form schemas with proper Zod types
- Implement schema-driven form store
- Write comprehensive schema tests
- Update bulk update schemas

### Week 2: Form Components

- implement songformfield with schema awareness
- refactor songeditform and songbulkeditform
- add visual feedback system
- implement proper input focus handling

### Week 3: API Integration

- update api client methods for schema-driven payloads
- refactor songinfomodal save logic
- add comprehensive error handling
- test end-to-end workflows

### Week 4: Polish & Testing

- add rating and favorite components
- implement unsaved changes warning
- complete e2e testing
- performance optimization and validation

## Benefits of Schema-Driven Approach

### 1. Type Safety

- full typescript inference from zod schemas
- compile-time checking of field names and types
- runtime validation of form data
- elimination of magic strings

### 2. Maintainability

- single source of truth for editable fields
- automatic categorization of metadata vs user preferences
- easy to add/remove fields by updating schemas
- self-documenting field configurations

### 3. Reliability

- schema-validated api payloads prevent empty updates
- consistent field handling across all forms
- automatic mixed value computation for bulk editing
- type-safe change detection

### 4. Developer Experience

- intellisense support for all field operations
- clear separation between different field types
- standardized field component with consistent behavior
- easy debugging with typed form state

### 5. User Experience

- consistent visual feedback across all editable fields
- individual reset buttons for any dirty field
- clear indication of bulk edit vs single edit behavior
- proper validation messages based on schema constraints

## Migration Strategy

1. **schema first**: implement schemas and validation without changing ui
2. **parallel forms**: build new form components alongside existing ones
3. **feature flag**: toggle between old and new form implementations
4. **field-by-field**: migrate one field type at a time (text, then numbers, then complex)
5. **api last**: update api integration after forms are stable
6. **gradual rollout**: enable for admin users first, then general users

this schema-driven approach ensures type safety, maintainability, and eliminates the current issues with empty api payloads while providing the magenta borders and reset functionality you requested.
