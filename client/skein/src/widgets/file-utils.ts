/**
 * utilities for file picking, uploading, and blob data fetching
 * in the skein widget system.
 *
 * supports two runtime modes:
 * - Tauri mode: native file dialogs + IPC invoke for uploads
 * - browser mode: hidden <input> file picker (upload requires Tauri)
 */

import { isTauriMode } from "../p2p/tauri-transport";

const TAG = "[file-utils]";

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

/** result from picking a file */
export interface PickedFile {
  /** file path (Tauri mode only — null in browser mode) */
  path: string | null;
  /** filename with extension */
  filename: string;
  /** file size in bytes (0 when unknown, e.g. Tauri mode before upload) */
  size: number;
  /** the raw File object (browser mode only — null in Tauri mode) */
  file: File | null;
}

/** result from uploading a file */
export interface FileUploadResult {
  blobId: string;
  domain: string;
  entityId: string;
  jobId: string | null;
  sha256: string;
  blake3: string | null;
  size: number;
  mime: string;
  existing: boolean;
}

/** options for file upload */
export interface UploadOptions {
  title?: string;
  description?: string;
  metadata?: string;
  /** wait for thumbnail job to complete before returning (default: true) */
  waitForCompletion?: boolean;
}

// ---------------------------------------------------------------------------
// tauri bridge helper
// ---------------------------------------------------------------------------

/**
 * invoke a Tauri command. lazily imports @tauri-apps/api/core so the module
 * can be parsed even when Tauri is not present.
 */
async function tauriInvoke(cmd: string, args: Record<string, unknown>): Promise<any> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args);
}

// ---------------------------------------------------------------------------
// pickFile
// ---------------------------------------------------------------------------

/**
 * open a file picker dialog.
 * in Tauri mode, uses the native dialog plugin to get a file path.
 * in browser mode, uses a hidden `<input type="file">` to get a File object.
 * returns null if the user cancels.
 */
export async function pickFile(): Promise<PickedFile | null> {
  if (isTauriMode()) {
    return pickFileTauri();
  }
  return pickFileBrowser();
}

/**
 * dynamically load the Tauri dialog plugin.
 * uses a variable module specifier so TypeScript doesn't try to resolve
 * the package at compile time (it's only available in Tauri builds).
 */
async function loadTauriDialog(): Promise<{
  open: (options?: { multiple?: boolean }) => Promise<string | string[] | null>;
}> {
  // @ts-ignore — @tauri-apps/plugin-dialog is only available in Tauri builds
  return import("@tauri-apps/plugin-dialog");
}

/** Tauri-mode file picker — uses @tauri-apps/plugin-dialog */
async function pickFileTauri(): Promise<PickedFile | null> {
  try {
    const { open } = await loadTauriDialog();
    const result = await open({ multiple: false });

    if (result === null) {
      return null;
    }

    // open() returns string | string[] | null — normalize to a single path
    const filePath = Array.isArray(result) ? result[0] : result;
    if (!filePath) {
      return null;
    }

    // extract filename from the full path (handle both / and \ separators)
    const filename = filePath.split(/[\\/]/).pop() ?? filePath;

    return {
      path: filePath,
      filename,
      size: 0, // unknown until the file is uploaded
      file: null,
    };
  } catch (err) {
    console.error(TAG, "native file picker failed:", err);
    return null;
  }
}

/** browser-mode file picker — uses a hidden <input type="file"> */
async function pickFileBrowser(): Promise<PickedFile | null> {
  const input = document.createElement("input");
  input.type = "file";
  input.style.display = "none";

  document.body.appendChild(input);

  try {
    input.click();

    const file = await new Promise<File | null>((resolve) => {
      input.addEventListener("change", () => {
        resolve(input.files?.[0] ?? null);
      });

      // detect cancellation — the input element fires no event on cancel,
      // but a focus event on the window fires shortly after the picker closes.
      const onFocus = () => {
        window.removeEventListener("focus", onFocus);
        // small delay so "change" fires first if a file was picked
        setTimeout(() => resolve(null), 300);
      };
      window.addEventListener("focus", onFocus);
    });

    if (!file) {
      return null;
    }

    return {
      path: null,
      filename: file.name,
      size: file.size,
      file,
    };
  } catch (err) {
    console.error(TAG, "browser file picker failed:", err);
    return null;
  } finally {
    input.remove();
  }
}

// ---------------------------------------------------------------------------
// uploadFile
// ---------------------------------------------------------------------------

/**
 * upload a picked file to grimoire via the ingest pipeline.
 * in Tauri mode, passes the file path directly (no data copy needed).
 * in browser mode, reads the file as base64 and sends the data.
 *
 * NOTE: upload currently requires Tauri mode. browser-only upload will
 * be supported once an HTTP fallback is implemented.
 */
export async function uploadFile(
  picked: PickedFile,
  options?: UploadOptions
): Promise<FileUploadResult> {
  if (!isTauriMode()) {
    throw new Error(
      "file upload requires the desktop app or an HTTP connection — " +
        "browser-only upload is not yet supported"
    );
  }

  const body: Record<string, unknown> = {
    filename: picked.filename,
    title: options?.title,
    description: options?.description,
    metadata: options?.metadata,
    wait_for_completion: options?.waitForCompletion ?? true,
  };

  if (picked.path) {
    // Tauri mode — pass the native file path directly
    body.file_path = picked.path;
  } else if (picked.file) {
    // browser File object available — read as base64 for IPC transport
    const base64 = await fileToBase64(picked.file);
    body.data = base64;
  } else {
    throw new Error("picked file has neither a path nor a File object");
  }

  const response = await tauriInvoke("api_call", {
    path: "/api/upload/file",
    body,
  });

  if (!response.success) {
    const detail = response.errors?.[0]?.detail ?? response.message ?? "upload failed";
    throw new Error(`file upload failed: ${detail}`);
  }

  const d = response.data;
  if (!d) {
    throw new Error("file upload returned no data");
  }

  return {
    blobId: d.blob_id,
    domain: d.domain,
    entityId: d.entity_id,
    jobId: d.job_id ?? null,
    sha256: d.sha256,
    blake3: d.blake3 ?? null,
    size: d.size,
    mime: d.mime,
    existing: d.existing ?? false,
  };
}

// ---------------------------------------------------------------------------
// getThumbnailDataUrl
// ---------------------------------------------------------------------------

/**
 * fetch thumbnail image data for a blob and return it as a data URL.
 * walks the blob parent-child chain to find the best available thumbnail.
 * returns null if no thumbnail is available or if not in Tauri mode.
 */
export async function getThumbnailDataUrl(blobId: string, size?: number): Promise<string | null> {
  if (!isTauriMode()) {
    return null;
  }

  try {
    const response = await tauriInvoke("api_call", {
      path: "/api/blobs/thumbnail_data",
      body: {
        blob_id: blobId,
        size: size ?? 200,
      },
    });

    if (!response.success || !response.data) {
      return null;
    }

    const { data, mime } = response.data;
    if (!data || !mime) {
      return null;
    }

    return `data:${mime};base64,${data}`;
  } catch (err) {
    console.warn(TAG, "failed to fetch thumbnail for blob", blobId, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// formatFileSize
// ---------------------------------------------------------------------------

/**
 * format a file size in bytes to a human-readable string.
 * e.g. 1024 -> "1.0 KB", 1048576 -> "1.0 MB"
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  // show decimals only for KB and above
  if (unitIndex === 0) {
    return `${value} ${units[unitIndex]}`;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

// ---------------------------------------------------------------------------
// internal helpers
// ---------------------------------------------------------------------------

/** read a File as a base64-encoded string (without the data URL prefix) */
async function fileToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // strip "data:<mime>;base64," prefix to get raw base64
      const commaIndex = dataUrl.indexOf(",");
      resolve(commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
