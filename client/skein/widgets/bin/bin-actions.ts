/**
 * batch actions for the bin widget — currently provides "snatch all" which
 * downloads all remote file blobs from P2P peers sequentially with progress.
 */

import type { DocumentId, Repo } from "@automerge/automerge-repo";
import type { CanvasStore } from "../../src/canvas/canvas-store";
import {
    checkBlobLocality,
    getThumbnailDataUrl,
    snatchBlob,
    type PeersMap,
    type SnatchBlobInfo,
} from "../../src/widgets/file-utils";
import { fileSchema, type FileState } from "../file";
import { binSchema } from "./index";

// -----------------------------------------------------------------------
// types
// -----------------------------------------------------------------------

export interface SnatchAllProgress {
  /** total items to check */
  total: number;
  /** items already local (skipped) */
  alreadyLocal: number;
  /** items successfully snatched so far */
  snatched: number;
  /** items that failed */
  failed: number;
  /** currently downloading item index (0-based within remote items) */
  currentIndex: number;
  /** download progress of current item (0.0 to 1.0) */
  currentProgress: number;
  /** whether the operation is complete */
  done: boolean;
}

export type SnatchAllCallback = (progress: SnatchAllProgress) => void;

export interface SnatchAllOptions {
  onProgress?: SnatchAllCallback;
  signal?: AbortSignal;
}

const TAG = "[bin-actions]";

// -----------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------

/** info about a remote file that needs snatching */
interface RemoteItem {
  widgetId: string;
  docId: string;
  state: FileState;
}

/**
 * recursively collect all file widget children of a bin, including files
 * nested inside child bins. returns a flat list of widget IDs paired with
 * their doc IDs and parsed file state.
 */
async function collectFileChildren(
  binWidgetId: string,
  store: CanvasStore,
  repo: Repo
): Promise<RemoteItem[]> {
  const binEntry = store.getWidget(binWidgetId);
  if (!binEntry || !binEntry.docId) return [];

  const handle = repo.handles[binEntry.docId as DocumentId];
  if (!handle) return [];

  const doc = handle.doc();
  if (!doc) return [];

  // parse through bin schema to get the items array
  let items: Array<{ widgetId: string }>;
  try {
    const parsed = binSchema.parse(doc);
    items = parsed.items;
  } catch {
    console.warn(TAG, "failed to parse bin doc for", binWidgetId);
    return [];
  }

  const result: RemoteItem[] = [];

  for (const item of items) {
    const childEntry = store.getWidget(item.widgetId);
    if (!childEntry) continue;

    // recurse into nested bins
    if (childEntry.type === "bin") {
      const nested = await collectFileChildren(item.widgetId, store, repo);
      result.push(...nested);
      continue;
    }

    // only process file widgets
    if (childEntry.type !== "file") continue;
    if (!childEntry.docId) continue;

    const childHandle = repo.handles[childEntry.docId as DocumentId];
    if (!childHandle) continue;

    const childDoc = childHandle.doc();
    if (!childDoc) continue;

    try {
      const state = fileSchema.parse(childDoc);
      if (!state.blobId) continue;
      result.push({
        widgetId: item.widgetId,
        docId: childEntry.docId,
        state,
      });
    } catch {
      console.warn(TAG, "failed to parse file doc for", item.widgetId);
    }
  }

  return result;
}

// -----------------------------------------------------------------------
// main
// -----------------------------------------------------------------------

/**
 * download all remote file blobs inside a bin (and nested bins) sequentially.
 * already-local files are skipped. progress is reported via the callback.
 */
export async function snatchAllInBin(
  binWidgetId: string,
  store: CanvasStore,
  repo: Repo,
  peers: PeersMap,
  options?: SnatchAllOptions
): Promise<SnatchAllProgress> {
  const { onProgress, signal } = options ?? {};

  const progress: SnatchAllProgress = {
    total: 0,
    alreadyLocal: 0,
    snatched: 0,
    failed: 0,
    currentIndex: 0,
    currentProgress: 0,
    done: false,
  };

  const emit = () => onProgress?.({ ...progress });

  // step 1: collect all file children (recursing into nested bins)
  const allFiles = await collectFileChildren(binWidgetId, store, repo);
  progress.total = allFiles.length;
  emit();

  if (allFiles.length === 0) {
    progress.done = true;
    emit();
    return progress;
  }

  // step 2: check locality for each file and partition into local vs remote
  const remoteFiles: RemoteItem[] = [];

  for (const file of allFiles) {
    if (signal?.aborted) {
      progress.done = true;
      emit();
      return progress;
    }

    try {
      const localityInfo = await checkBlobLocality(file.state.blobId, file.state.blake3 || undefined);
      if (localityInfo.locality === "local") {
        progress.alreadyLocal++;
        emit();
        continue;
      }
    } catch (err) {
      console.debug(TAG, "locality check failed for", file.state.blobId, err);
      // treat as remote — try snatching anyway
    }

    remoteFiles.push(file);
  }

  // if everything is already local, we're done
  if (remoteFiles.length === 0) {
    progress.done = true;
    emit();
    return progress;
  }

  // step 3: snatch each remote file sequentially
  for (let i = 0; i < remoteFiles.length; i++) {
    if (signal?.aborted) {
      progress.done = true;
      emit();
      return progress;
    }

    const file = remoteFiles[i];
    progress.currentIndex = i;
    progress.currentProgress = 0;
    emit();

    const info: SnatchBlobInfo = {
      blobId: file.state.blobId,
      filename: file.state.filename,
      mime: file.state.mime,
      size: file.state.size,
      blake3: file.state.blake3,
      domain: file.state.domain,
    };

    try {
      const result = await snatchBlob(info, peers, {
        onProgress: (fraction) => {
          progress.currentProgress = fraction >= 0 ? fraction : 0;
          emit();
        },
        signal,
        isPeerOnline: (nodeId: string) => store.isPeerOnline(nodeId),
      });

      // update the child widget's automerge doc with the snatch result
      const childHandle = repo.handles[file.docId as DocumentId];
      if (childHandle) {
        childHandle.change((draft: any) => {
          draft.blobId = result.blobId;
          draft.domain = result.domain;
          draft.entityId = result.entityId;
          draft.mime = result.mime;
          draft.size = result.size;
          draft.blake3 = result.blake3 ?? "";
        });

        // attempt to generate/fetch a thumbnail and write it to the doc
        try {
          const thumbDataUrl = await getThumbnailDataUrl(result.blobId, { size: 200 });
          if (thumbDataUrl) {
            childHandle.change((draft: any) => {
              draft.thumbnailDataUrl = thumbDataUrl;
            });
          }
        } catch {
          // thumbnail generation is best-effort — don't fail the snatch
          console.debug(TAG, "thumbnail generation failed for", result.blobId);
        }
      }

      progress.snatched++;
      progress.currentProgress = 1;
      emit();
    } catch (err) {
      if (signal?.aborted) {
        progress.done = true;
        emit();
        return progress;
      }

      console.warn(TAG, `snatch failed for ${file.state.filename}:`, err);
      progress.failed++;
      emit();
      // continue to next item — don't abort the whole batch
    }
  }

  progress.done = true;
  emit();
  return progress;
}
