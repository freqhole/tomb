/**
 * unified cross-platform file picker.
 *
 * wraps three different mechanisms behind a single api:
 *
 *   - **plain web / non-tauri**: hidden `<input type=file>` triggered
 *     programmatically; yields real `File` objects with no path info.
 *
 *   - **desktop tauri (mac/linux/windows)**: `tauri-plugin-dialog` opens the
 *     native picker and returns real filesystem paths. if the caller asks
 *     for bytes, we lazily read them via `tauri-plugin-fs`; otherwise the
 *     path alone is returned so callers (e.g. the music importer) can keep
 *     "file in place" semantics.
 *
 *   - **android tauri**: `tauri-plugin-dialog` returns `content://` uris.
 *     those can't be used as paths, fetched from the webview, or held onto
 *     across process restarts — so we always read the bytes immediately via
 *     `tauri-plugin-fs.readFile()` and wrap them into a `File`.
 *
 * callers get a uniform `PickedFile[]` result; each entry always has a
 * `name` and a usable `File` (unless the caller opted out of bytes),
 * plus an optional `path` / `contentUri` when the underlying platform
 * surfaces one.
 */

import { debug } from "./logger";

export type FileKind = "audio" | "image";

export interface PickedFile {
  /** display filename (best-effort — derived from path/uri when native picker doesn't surface one) */
  name: string;
  /**
   * a usable `File`. always populated on web + android. populated on
   * desktop only when `readBytes` is true (default). absent means the
   * caller asked for path-only mode on desktop.
   */
  file?: File;
  /** real filesystem path. only set on desktop tauri. */
  path?: string;
  /** content uri. only set on android tauri (useful for debugging). */
  contentUri?: string;
}

export interface PickFilesOptions {
  kind: FileKind;
  multiple?: boolean;
  /**
   * whether to read file bytes into a `File` object.
   * - defaults to true (required for web/android, useful everywhere)
   * - set to false on desktop if you only need the path (e.g. "file in place"
   *   music import that hands the path to a native p2p importer). ignored
   *   on web/android since those platforms can't surface a path.
   */
  readBytes?: boolean;
  /** picker dialog title (native dialogs only). */
  title?: string;
}

// file extension filters per kind (used by native dialogs).
const AUDIO_EXTS = ["mp3", "flac", "wav", "m4a", "ogg", "aac", "alac", "wma"];
const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "avif"];

// accept attribute for <input type=file> on the web.
const WEB_ACCEPT: Record<FileKind, string> = {
  audio: "audio/*",
  image: "image/*",
};

// rough mime guess from extension for wrapping read bytes into a `File`.
// the blob's type is cosmetic here — the backend re-sniffs via content.
function guessMime(name: string, kind: FileKind): string {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (kind === "image") {
    if (ext === "png") return "image/png";
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "gif") return "image/gif";
    if (ext === "webp") return "image/webp";
    if (ext === "avif") return "image/avif";
    return "image/*";
  }
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "flac") return "audio/flac";
  if (ext === "wav") return "audio/wav";
  if (ext === "m4a" || ext === "alac") return "audio/mp4";
  if (ext === "ogg") return "audio/ogg";
  if (ext === "aac") return "audio/aac";
  return "audio/*";
}

// derive a displayable filename from a path or content:// uri.
function nameFromPathOrUri(s: string): string {
  // strip query/fragment
  const bare = s.split("?")[0]!.split("#")[0]!;
  const last = bare.split(/[\\/]/).pop() || "file";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

// true when running inside a tauri runtime (desktop or mobile).
function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  // @ts-expect-error __TAURI_INTERNALS__ injected by tauri
  return typeof window.__TAURI_INTERNALS__?.invoke === "function";
}

function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
}

type TauriDialogOpenFn = (options: {
  multiple?: boolean;
  directory?: boolean;
  filters?: { name: string; extensions: string[] }[];
  title?: string;
}) => Promise<string | string[] | null>;

type TauriFsReadFileFn = (path: string) => Promise<Uint8Array>;

async function loadDialog(): Promise<{ open: TauriDialogOpenFn }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await import("@tauri-apps/plugin-dialog" as any)) as { open: TauriDialogOpenFn };
}

async function loadFs(): Promise<{ readFile: TauriFsReadFileFn }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await import("@tauri-apps/plugin-fs" as any)) as { readFile: TauriFsReadFileFn };
}

async function pickViaInputElement(opts: PickFilesOptions): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = WEB_ACCEPT[opts.kind];
    if (opts.multiple) input.multiple = true;
    // hide but keep focusable
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.top = "-9999px";

    let settled = false;
    const finish = (picked: PickedFile[]) => {
      if (settled) return;
      settled = true;
      document.body.removeChild(input);
      resolve(picked);
    };

    input.addEventListener("change", () => {
      const files = input.files;
      if (!files || files.length === 0) {
        finish([]);
        return;
      }
      const out: PickedFile[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files.item(i);
        if (!f) continue;
        out.push({ name: f.name, file: f });
      }
      finish(out);
    });

    // in most browsers there's no reliable "cancel" event; the picker just
    // returns with no files. that'll fire `change` with an empty filelist
    // on some browsers, or not fire at all on others. either way the caller
    // sees an empty array eventually or the promise lingers until next pick.
    input.addEventListener("cancel", () => finish([]));

    document.body.appendChild(input);
    input.click();
  });
}

async function pickViaTauriDialog(opts: PickFilesOptions): Promise<PickedFile[]> {
  const dialog = await loadDialog();
  const filters = [
    {
      name: opts.kind === "audio" ? "audio" : "images",
      extensions: opts.kind === "audio" ? AUDIO_EXTS : IMAGE_EXTS,
    },
  ];
  const title = opts.title ?? (opts.kind === "audio" ? "select music files" : "select image");

  const selected = await dialog.open({
    multiple: !!opts.multiple,
    filters,
    title,
  });
  if (!selected) return [];
  const entries = Array.isArray(selected) ? selected : [selected];
  if (entries.length === 0) return [];

  const android = isAndroid();
  const readBytes = opts.readBytes ?? true;
  // on android we always have to read bytes — content:// uris aren't usable
  // as paths anywhere else in the app.
  const mustRead = android || readBytes;

  const fs = mustRead ? await loadFs() : null;

  const out: PickedFile[] = [];
  for (const entry of entries) {
    const name = nameFromPathOrUri(entry);
    const picked: PickedFile = { name };
    if (android) {
      picked.contentUri = entry;
    } else {
      picked.path = entry;
    }
    if (mustRead && fs) {
      try {
        const data = await fs.readFile(entry);
        // cast: tauri-plugin-fs returns `Uint8Array<ArrayBufferLike>` which
        // newer ts lib.dom typings reject as a BlobPart; the runtime accepts
        // it fine.
        picked.file = new File([data as BlobPart], name, {
          type: guessMime(name, opts.kind),
        });
      } catch (err) {
        debug("filePicker", "failed to read picked entry:", entry, err);
        // skip entries we can't read — better to drop one than poison the batch
        continue;
      }
    }
    out.push(picked);
  }
  return out;
}

/**
 * open a native-or-web file picker and return picked files in a uniform
 * shape. on desktop tauri, paths are returned and bytes are read lazily
 * only when `readBytes !== false`. on android tauri, content uris are
 * returned and bytes are always read eagerly. on plain web, real `File`
 * objects are returned from a hidden `<input type=file>`.
 */
export async function pickFiles(opts: PickFilesOptions): Promise<PickedFile[]> {
  if (isTauri()) {
    try {
      return await pickViaTauriDialog(opts);
    } catch (err) {
      debug("filePicker", "tauri dialog failed, falling back to input:", err);
      // fall through to html input as a last resort
    }
  }
  return pickViaInputElement(opts);
}

/** convenience: pick a single file, or null if cancelled. */
export async function pickFile(
  opts: Omit<PickFilesOptions, "multiple">,
): Promise<PickedFile | null> {
  const picked = await pickFiles({ ...opts, multiple: false });
  return picked[0] ?? null;
}

/**
 * pick a directory (desktop tauri only). returns the selected path or
 * null if cancelled / unavailable. this stays separate from `pickFiles`
 * because it has a meaningfully different result shape and isn't
 * supported on web or android.
 */
export async function pickDirectory(title = "select folder"): Promise<string | null> {
  if (!isTauri()) return null;
  if (isAndroid()) return null;
  try {
    const dialog = await loadDialog();
    const selected = await dialog.open({ multiple: false, directory: true, title });
    if (selected && typeof selected === "string") return selected;
    return null;
  } catch (err) {
    debug("filePicker", "pickDirectory failed:", err);
    return null;
  }
}
