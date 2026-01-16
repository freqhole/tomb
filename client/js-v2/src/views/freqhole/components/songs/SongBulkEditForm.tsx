import { createEffect, For, onMount } from "solid-js";
import { useSongFormStore } from "../../../../hooks/forms/useFormStore";
import { SongFormField } from "../forms/SongFormField";
import { FormFieldConfig } from "../../../../lib/music/schemas/form-schemas";
import type { Song } from "../../../../lib/music/schemas/song";
import type { EditableSongFields } from "../../../../lib/music/schemas/form-schemas";

interface SongBulkEditFormProps {
  songs: Song[];
  onFormChange: (changes: Partial<EditableSongFields>) => void;
  initialChanges?: Partial<EditableSongFields>;
  hideHeader?: boolean;
}

export function SongBulkEditForm(props: SongBulkEditFormProps) {
  const formStore = useSongFormStore(props.songs); // pass array for bulk mode

  // apply initial changes if provided (run only once on mount)
  onMount(() => {
    if (props.initialChanges) {
      Object.entries(props.initialChanges).forEach(([field, value]) => {
        if (value !== undefined) {
          formStore.updateField(
            field as keyof EditableSongFields,
            value as any
          );
        }
      });
    }
  });

  // only send changes to parent (not the full mixed state)
  createEffect(() => {
    props.onFormChange(formStore.changes());
  });

  return (
    <div class="space-y-6">
      {/* bulk edit header */}
      {!props.hideHeader && (
        <div class="bg-gray-800/50 p-4 border border-gray-700">
          <div class="font-medium text-white mb-1">
            bulk editing: {props.songs.length} songs
          </div>
          <div class="text-sm text-gray-400">
            fields showing "mixed values" contain different values across
            selected songs
          </div>

          {formStore.isDirty() && (
            <div class="text-xs text-magenta-400 mt-2 flex items-center gap-2">
              <div class="w-2 h-2 bg-magenta-500"></div>
              {Object.keys(formStore.changes()).length} field(s) will be updated
              across all songs
            </div>
          )}
        </div>
      )}

      {/* metadata fields */}
      <div class="space-y-4">
        <h3 class="text-lg font-medium text-gray-200 border-b border-gray-700 pb-2">
          song metadata
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <For
            each={
              Object.keys(FormFieldConfig.metadata) as Array<
                keyof typeof FormFieldConfig.metadata
              >
            }
          >
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

      {/* user preference fields */}
      <div class="space-y-4">
        <h3 class="text-lg font-medium text-gray-200 border-b border-gray-700 pb-2">
          personal preferences
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <For
            each={
              Object.keys(FormFieldConfig.userPreferences) as Array<
                keyof typeof FormFieldConfig.userPreferences
              >
            }
          >
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

      {/* form actions */}
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
