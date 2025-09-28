import { createEffect, For, onMount } from "solid-js";
import { useSongFormStore } from "../../../../hooks/forms/useFormStore";
import { SongFormField } from "../forms/SongFormField";
import { FormFieldConfig } from "../../../../lib/music/schemas/form-schemas";
import type { Song } from "../../../../lib/music/schemas/song";
import type { EditableSongFields } from "../../../../lib/music/schemas/form-schemas";
import { ImageCarousel } from "./ImageCarousel";

interface SongEditFormProps {
  song: Song;
  songs?: Song[];
  currentIndex?: number;
  onSongChange?: (index: number) => void;
  onFormChange: (changes: Partial<EditableSongFields>) => void;
  initialChanges?: Partial<EditableSongFields>;
  hidePagination?: boolean;
  hideHeader?: boolean;
}

export function SongEditForm(props: SongEditFormProps) {
  const formStore = useSongFormStore(props.song);

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

  // automatically notify parent when changes occur
  createEffect(() => {
    props.onFormChange(formStore.changes());
  });

  const totalSongs = () => props.songs?.length || 1;
  const currentIndex = () => props.currentIndex || 0;
  const canGoPrevious = () => currentIndex() > 0;
  const canGoNext = () => currentIndex() < totalSongs() - 1;
  const isMultipleSongs = () => totalSongs() > 1;

  const goToPrevious = () => {
    if (canGoPrevious() && props.onSongChange) {
      props.onSongChange(currentIndex() - 1);
    }
  };

  const goToNext = () => {
    if (canGoNext() && props.onSongChange) {
      props.onSongChange(currentIndex() + 1);
    }
  };

  return (
    <div class="space-y-6">
      {/* pagination - shown when multiple songs */}
      {isMultipleSongs() && !props.hidePagination && (
        <div class="flex items-center justify-between pb-4 border-b border-gray-700">
          <div class="flex items-center gap-4">
            <button
              onClick={goToPrevious}
              class="px-3 py-1 text-sm text-gray-300 hover:text-white transition-colors disabled:opacity-50"
              disabled={!canGoPrevious()}
            >
              ← previous
            </button>
            <span class="text-sm text-gray-400">
              {currentIndex() + 1} of {totalSongs()}
            </span>
            <button
              onClick={goToNext}
              class="px-3 py-1 text-sm text-gray-300 hover:text-white transition-colors disabled:opacity-50"
              disabled={!canGoNext()}
            >
              next →
            </button>
          </div>
        </div>
      )}

      {/* song header */}
      {!props.hideHeader && (
        <div class="bg-gray-800/50 p-4 border border-gray-700">
          <div class="font-medium text-white mb-1">
            editing: {props.song.title || "untitled"}
          </div>
          <div class="text-sm text-gray-300">
            {props.song.artist}
            {props.song.album && <span class="ml-2">• {props.song.album}</span>}
            {props.song.year && <span class="ml-2">• {props.song.year}</span>}
            {isMultipleSongs() && (
              <span class="ml-2">
                • {currentIndex() + 1} of {totalSongs()}
              </span>
            )}
          </div>

          {formStore.isDirty() && (
            <div class="text-xs text-magenta-400 mt-2 flex items-center gap-2">
              <div class="w-2 h-2 bg-magenta-500"></div>
              {Object.keys(formStore.changes()).length} field(s) will be updated
            </div>
          )}
        </div>
      )}

      {/* image carousel */}
      <ImageCarousel
        songs={[props.song]}
        currentSongIndex={0}
        isBulkMode={false}
      />

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
