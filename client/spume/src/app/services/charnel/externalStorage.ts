/**
 * removable-storage sync command wrappers (JS -> Rust via invoke)
 *
 * kept isolated from `commands.ts` since this is a self-contained feature
 * (see docs/removable-storage-sync-plan.md in the tomb repo root). talks
 * to the single `external_storage_command` tauri command, tagged by
 * `action` on the rust side (see
 * client/charnel/src-tauri/src/external_storage/commands.rs).
 *
 * only callable in tauri mode - every function here fails soft (returns
 * null/empty) in browser builds rather than throwing.
 */

import { z } from "zod";

const ExternalStorageDeviceSchema = z.object({
  id: z.string(),
  path: z.string(),
  volume_name: z.string().nullish(),
  volume_uuid: z.string().nullish(),
  subpath: z.string().nullish(),
  last_synced_at: z.number().nullish(),
});

export type ExternalStorageDevice = z.infer<typeof ExternalStorageDeviceSchema>;

// sentinel id for the synthetic "favorites" row - matches
// `playlist_sync::FAVORITES_KEY` on the rust side. shared here so every
// caller (overview view, "send to device" actions) uses the same string.
export const FAVORITES_SYNC_ID = "favorites";

const DiskUsageResultSchema = z.object({
  total_bytes: z.number(),
  free_bytes: z.number(),
  used_bytes: z.number(),
});

export type DiskUsageResult = z.infer<typeof DiskUsageResultSchema>;

// dynamically import tauri to allow tree-shaking in browser builds
async function getInvoke() {
  // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke;
}

async function externalStorageCommand(action: Record<string, unknown>): Promise<unknown> {
  const invoke = await getInvoke();
  return invoke("external_storage_command", { action });
}

/**
 * of the remembered devices, which ones are currently mounted. drives
 * playerbar icon visibility - an empty array means "nothing plugged in".
 */
export async function listMountedExternalStorageDevices(): Promise<ExternalStorageDevice[]> {
  try {
    const result = await externalStorageCommand({ action: "list_mounted" });
    return z.array(ExternalStorageDeviceSchema).parse(result);
  } catch (error) {
    console.error("[charnel/externalStorage] failed to list mounted devices:", error);
    return [];
  }
}

/**
 * the currently-active device, if one is selected and still mounted.
 */
export async function getActiveExternalStorageDevice(): Promise<ExternalStorageDevice | null> {
  try {
    const result = await externalStorageCommand({ action: "get_active" });
    if (!result) {
      return null;
    }
    return ExternalStorageDeviceSchema.parse(result);
  } catch (error) {
    console.error("[charnel/externalStorage] failed to get active device:", error);
    return null;
  }
}

/**
 * total/free/used space (bytes) on the filesystem a remembered device
 * lives on. returns null if the device isn't found or the platform-
 * specific disk-usage lookup fails.
 */
export async function getExternalStorageDiskUsage(id: string): Promise<DiskUsageResult | null> {
  try {
    const result = await externalStorageCommand({ action: "disk_usage", id });
    return DiskUsageResultSchema.parse(result);
  } catch (error) {
    console.error("[charnel/externalStorage] failed to get disk usage:", error);
    return null;
  }
}

/**
 * eject a device (macOS: `diskutil eject`, linux: `udisksctl unmount`).
 * the background mount watcher picks up the resulting unmount and emits
 * `external-storage-mounted-changed` on its own - callers don't need to
 * do anything else after this resolves.
 */
export async function ejectExternalStorageDevice(id: string): Promise<boolean> {
  try {
    await externalStorageCommand({ action: "eject_device", id });
    return true;
  } catch (error) {
    console.error("[charnel/externalStorage] failed to eject device:", error);
    return false;
  }
}

/**
 * playlist ids (plus the synthetic `"favorites"` id) currently synced to
 * a device - drives the overview view's checkbox state.
 */
export async function getSyncedPlaylistIds(deviceId: string): Promise<string[]> {
  try {
    const result = await externalStorageCommand({
      action: "get_synced_playlist_ids",
      device_id: deviceId,
    });
    return z.array(z.string()).parse(result);
  } catch (error) {
    console.error("[charnel/externalStorage] failed to get synced playlist ids:", error);
    return [];
  }
}

const PlaylistSyncOutcomeSchema = z.object({
  playlist_id: z.string(),
  title: z.string(),
  filename: z.string(),
  song_count: z.number(),
  failed_songs: z.array(z.string()),
});

const SyncPlaylistsResultSchema = z.object({
  synced: z.array(PlaylistSyncOutcomeSchema),
  removed: z.array(z.string()),
});

export type SyncPlaylistsResult = z.infer<typeof SyncPlaylistsResultSchema>;

/**
 * sync exactly this set of playlist ids (plus `"favorites"` if included)
 * to the device - deselected playlists have their `.m3u8` removed
 * (song files are never touched), selected ones get their songs synced
 * and their `.m3u8` regenerated.
 */
export async function syncPlaylistsToDevice(
  deviceId: string,
  playlistIds: string[]
): Promise<SyncPlaylistsResult | null> {
  try {
    const result = await externalStorageCommand({
      action: "sync_playlists",
      device_id: deviceId,
      playlist_ids: playlistIds,
    });
    return SyncPlaylistsResultSchema.parse(result);
  } catch (error) {
    console.error("[charnel/externalStorage] failed to sync playlists:", error);
    return null;
  }
}

const FilterSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  device_id: z.string().nullish(),
  created_at: z.number(),
  updated_at: z.number(),
});

export type FilterSet = z.infer<typeof FilterSetSchema>;

const FilterSetFilterSchema = z.object({
  id: z.string(),
  filter_set_id: z.string(),
  filter_type: z.string(),
  filter_value: z.string(),
  filter_label: z.string(),
  mode: z.string(),
  created_at: z.number(),
});

export type FilterSetFilter = z.infer<typeof FilterSetFilterSchema>;

/**
 * list every named sync filter-set (phase 6, "what to sync" rules).
 */
export async function listFilterSets(): Promise<FilterSet[]> {
  try {
    const result = await externalStorageCommand({ action: "list_filter_sets" });
    return z.array(FilterSetSchema).parse(result);
  } catch (error) {
    console.error("[charnel/externalStorage] failed to list filter sets:", error);
    return [];
  }
}

/**
 * create a new, empty named sync filter-set.
 */
export async function createFilterSet(name: string): Promise<FilterSet | null> {
  try {
    const result = await externalStorageCommand({ action: "create_filter_set", name });
    return FilterSetSchema.parse(result);
  } catch (error) {
    console.error("[charnel/externalStorage] failed to create filter set:", error);
    return null;
  }
}

/**
 * rename an existing sync filter-set.
 */
export async function renameFilterSet(id: string, name: string): Promise<FilterSet | null> {
  try {
    const result = await externalStorageCommand({ action: "rename_filter_set", id, name });
    return FilterSetSchema.parse(result);
  } catch (error) {
    console.error("[charnel/externalStorage] failed to rename filter set:", error);
    return null;
  }
}

/**
 * delete a sync filter-set (and its filter clauses, via cascade).
 */
export async function deleteFilterSet(id: string): Promise<boolean> {
  try {
    await externalStorageCommand({ action: "delete_filter_set", id });
    return true;
  } catch (error) {
    console.error("[charnel/externalStorage] failed to delete filter set:", error);
    return false;
  }
}

/**
 * the one default filter-set for a device, created on first use. this is
 * the entry point the overview view actually uses today - one set per
 * device (see docs/removable-storage-sync-plan.md phase 6).
 */
export async function getOrCreateDefaultFilterSet(deviceId: string): Promise<FilterSet | null> {
  try {
    const result = await externalStorageCommand({
      action: "get_or_create_default_filter_set",
      device_id: deviceId,
    });
    return FilterSetSchema.parse(result);
  } catch (error) {
    console.error("[charnel/externalStorage] failed to get/create default filter set:", error);
    return null;
  }
}

/**
 * list a filter-set's include/exclude filter clauses.
 */
export async function listFilterSetFilters(filterSetId: string): Promise<FilterSetFilter[]> {
  try {
    const result = await externalStorageCommand({
      action: "list_filter_set_filters",
      filter_set_id: filterSetId,
    });
    return z.array(FilterSetFilterSchema).parse(result);
  } catch (error) {
    console.error("[charnel/externalStorage] failed to list filter set filters:", error);
    return [];
  }
}

/**
 * add one include/exclude filter clause to a filter-set. `filterType` is
 * one of the `StationFilterType` variants (snake_case on the wire, e.g.
 * `"artist"`, `"rating_gte"`), `mode` is `"include"` or `"exclude"`.
 */
export async function addFilterSetFilter(
  filterSetId: string,
  filterType: string,
  filterValue: string,
  mode: string
): Promise<FilterSetFilter | null> {
  try {
    const result = await externalStorageCommand({
      action: "add_filter_set_filter",
      filter_set_id: filterSetId,
      filter_type: filterType,
      filter_value: filterValue,
      mode,
    });
    return FilterSetFilterSchema.parse(result);
  } catch (error) {
    console.error("[charnel/externalStorage] failed to add filter set filter:", error);
    return null;
  }
}

/**
 * remove one filter clause by its own id.
 */
export async function removeFilterSetFilter(filterId: string): Promise<boolean> {
  try {
    await externalStorageCommand({ action: "remove_filter_set_filter", filter_id: filterId });
    return true;
  } catch (error) {
    console.error("[charnel/externalStorage] failed to remove filter set filter:", error);
    return false;
  }
}

/**
 * resolve a filter-set to its effective (distinct) song id list, for
 * previewing a filter-set's song count before syncing.
 */
export async function resolveFilterSet(filterSetId: string): Promise<string[]> {
  try {
    const result = await externalStorageCommand({
      action: "resolve_filter_set",
      filter_set_id: filterSetId,
    });
    return z.array(z.string()).parse(result);
  } catch (error) {
    console.error("[charnel/externalStorage] failed to resolve filter set:", error);
    return [];
  }
}
