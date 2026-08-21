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
