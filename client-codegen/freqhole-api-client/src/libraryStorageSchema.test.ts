import { describe, expect, it, vi } from "vitest";
import {
  AdminClient,
  AdminCommandError,
  AdminRequestValidationError,
  AdminResponseValidationError,
} from "./AdminClient";

describe("removable library admin contracts", () => {
  it("preserves an explicit rendition opt-out when registering a source", async () => {
    const send = vi.fn(async () => ({ success: false, message: "disk absent", errors: [] }));
    const client = new AdminClient({ send });
    await expect(client.dispatchOrThrow("library_register_source", {
      device_path: "/dev/sda1", mount_path: "/disk", relative_path: "",
      domain: "both", generate_renditions: false,
    })).rejects.toBeInstanceOf(AdminCommandError);
    expect(send).toHaveBeenCalledWith("library_register_source", expect.objectContaining({ generate_renditions: false }));
  });

  it("validates resumable scan sessions and per-source counts/tags", async () => {
    const client = new AdminClient({
      send: async (command) => ({ success: true, message: "ok", data:
        command === "library_active_scans"
          ? [{ session_id: "scan", path: "/disk" }]
          : [{ source_id: "disk", music_count: 2, video_count: 3,
              tags: ["fatty"], generate_renditions: false }],
      }),
    });
    expect(await client.dispatchOrThrow("library_active_scans", undefined))
      .toEqual([{ session_id: "scan", path: "/disk" }]);
    expect(await client.dispatchOrThrow("library_source_summaries", undefined))
      .toEqual([{ source_id: "disk", music_count: 2, video_count: 3,
        tags: ["fatty"], generate_renditions: false }]);
  });

  it("accepts host rendition settings and requires an id for removal", async () => {
    const send = vi.fn(async () => ({
      success: true, message: "ok", data: { enabled: true, directory: "/data/renditions" },
    }));
    const client = new AdminClient({ send });
    expect(await client.dispatchOrThrow("library_rendition_settings", undefined))
      .toEqual({ enabled: true, directory: "/data/renditions" });
    await expect(client.dispatchOrThrow("library_remove_source",
      // @ts-expect-error malformed request must also fail at runtime
      {})).rejects.toBeInstanceOf(AdminRequestValidationError);
  });

  it("validates scan session status counts and request identity", async () => {
    const send = vi.fn(async () => ({
      success: true, message: "ok",
      data: { pending: 2, running: 1, completed: 4, failed: 1, total: 8 },
    }));
    const client = new AdminClient({ send });
    expect(await client.dispatchOrThrow("library_scan_status", { session_id: "scan-one" }))
      .toMatchObject({ pending: 2, total: 8 });
    expect(send).toHaveBeenCalledWith("library_scan_status", { session_id: "scan-one" });
  });
  it("preserves cancelled counts without requiring them from older hosts", async () => {
    const client = new AdminClient({
      send: async () => ({
        success: true, message: "ok",
        data: { pending: 0, running: 0, completed: 1, failed: 0, cancelled: 2, total: 3 },
      }),
    });
    expect(await client.dispatchOrThrow("library_scan_status", { session_id: "scan-one" }))
      .toMatchObject({ completed: 1, cancelled: 2, total: 3 });
  });
  it("validates volume observations, including unmounted read-only disks", async () => {
    const disk = {
      device_path: "/dev/sda1",
      uuid: "disk",
      partition_uuid: null,
      label: null,
      filesystem: "ext4",
      mount_points: [],
      read_only: true,
      size_bytes: 1024,
    };
    const send = vi.fn(async () => ({ success: true, message: "ok", data: [disk] }));
    const client = new AdminClient({ send });
    expect(await client.dispatchOrThrow("library_list_removable_volumes", undefined)).toEqual([
      disk,
    ]);
    expect(send).toHaveBeenCalledWith("library_list_removable_volumes", null);
  });

  it("rejects malformed inventory instead of treating missing mounts as an empty list", async () => {
    const client = new AdminClient({
      send: async () => ({ success: true, message: "ok", data: [{ device_path: "/dev/sda1" }] }),
    });
    await expect(
      client.dispatchOrThrow("library_list_removable_volumes", undefined),
    ).rejects.toBeInstanceOf(AdminResponseValidationError);
  });

  it("validates source selection fields before sending a registration", async () => {
    const send = vi.fn();
    const client = new AdminClient({ send });
    await expect(
      client.dispatchOrThrow("library_register_source", {
        device_path: "/dev/sda1",
        mount_path: "/media/music",
        relative_path: "",
        // @ts-expect-error invalid domain also fails at the runtime boundary
        domain: "audio",
      }),
    ).rejects.toBeInstanceOf(AdminRequestValidationError);
    expect(send).not.toHaveBeenCalled();
  });

  it("retains structured server errors for an unavailable disk", async () => {
    const client = new AdminClient({
      send: async () => ({
        success: false,
        message: "could not list removable volumes",
        errors: [
          {
            error_type: "storage_inventory_unsupported",
            title: "removable volume inventory failed",
            detail: "removable volume inventory currently requires Linux",
          },
        ],
      }),
    });
    const result = client.dispatchOrThrow("library_list_removable_volumes", undefined);
    await expect(result).rejects.toBeInstanceOf(AdminCommandError);
    await expect(result).rejects.toMatchObject({ errorType: "storage_inventory_unsupported" });
  });
});
