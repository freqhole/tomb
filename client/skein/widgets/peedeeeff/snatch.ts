/**
 * snatch / locality / save / reveal module for the peedeeeff widget.
 *
 * provides functions to check whether PDF + page blobs are local,
 * batch-snatch them from peers, save to disk, and reveal in finder.
 * all functions are pure-ish — they accept state and return results,
 * letting the caller handle UI updates.
 */

import {
    checkBlobLocality,
    revealBlobInFinder,
    saveBlobToDisk,
    snatchBlobBatch,
    type BatchSnatchOptions,
    type FileUploadResult,
    type PeersMap,
    type SnatchBlobInfo,
} from "../../src/widgets/file-utils";
import type { ActionState, PeedeeeffState } from "./types";

const TAG = "[peedeeeff:snatch]";

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

/** callbacks for progressive UI updates during a batch snatch */
export interface PdfSnatchCallbacks {
  /** status message for the body overlay (e.g. "snatching page 3 of 12...") */
  onStatusText?: (text: string) => void;
  /** short progress text for the header/button (e.g. "3/12") */
  onProgressText?: (text: string) => void;
  /**
   * called when a page blob completes — use for progressive rendering.
   * pageIndex is 0-based into pageBlobIds.
   */
  onPageComplete?: (pageIndex: number, result: FileUploadResult) => void;
}

/** result from a batch snatch of the PDF + all page blobs */
export interface PdfSnatchResult {
  /** result for the main PDF blob (null if no blobId) */
  pdfResult: FileUploadResult | null;
  /** results for each page blob (null entries for failures) */
  pageResults: (FileUploadResult | null)[];
}

// ---------------------------------------------------------------------------
// checkPdfLocality
// ---------------------------------------------------------------------------

/**
 * checks whether the PDF blob and page blobs are available locally.
 *
 * logic:
 * - no blobId and no pageBlobIds -> "checking" (nothing to check)
 * - blobId exists: check main PDF blob. if NOT local -> "remote"
 * - PDF local + pageBlobIds exist: spot-check first page blob
 * - PDF local + no pageBlobIds -> "local" (pages may still be rendering)
 * - no blobId but pageBlobIds exist: check first page blob
 */
export async function checkPdfLocality(state: PeedeeeffState): Promise<ActionState> {
  const { blobId, blake3, pageBlobIds, pageBlake3s } = state;

  if (!blobId && pageBlobIds.length === 0) {
    return "checking";
  }

  if (blobId) {
    const info = await checkBlobLocality(blobId, blake3 || undefined);

    if (info.locality !== "local") {
      console.debug(TAG, "main PDF blob is remote:", blobId.slice(0, 12));
      return "remote";
    }

    // PDF is local — check page blobs if present
    if (pageBlobIds.length > 0) {
      const firstPageBlake3 = pageBlake3s?.[0] || undefined;
      const pageInfo = await checkBlobLocality(pageBlobIds[0], firstPageBlake3);

      if (pageInfo.locality === "local") {
        return "local";
      }
      console.debug(TAG, "PDF local but first page blob is remote");
      return "remote";
    }

    // PDF local, no page blobs yet (may still be rendering)
    return "local";
  }

  // no main blobId but pageBlobIds exist — check first page
  if (pageBlobIds.length > 0) {
    const firstPageBlake3 = pageBlake3s?.[0] || undefined;
    const pageInfo = await checkBlobLocality(pageBlobIds[0], firstPageBlake3);

    if (pageInfo.locality === "local") {
      return "local";
    }
    return "remote";
  }

  return "checking";
}

// ---------------------------------------------------------------------------
// snatchPdfContent
// ---------------------------------------------------------------------------

/**
 * batch-snatch the PDF blob and all page image blobs from peers.
 *
 * uses snatchBlobBatch from file-utils which probes peers once and downloads
 * all blobs from the winning peer. progress is reported via callbacks so the
 * caller can update overlays and buttons incrementally.
 */
export async function snatchPdfContent(
  state: PeedeeeffState,
  peers: PeersMap,
  signal: AbortSignal,
  callbacks: PdfSnatchCallbacks,
  isPeerOnline?: (nodeId: string) => boolean,
): Promise<PdfSnatchResult> {
  const allBlobs: SnatchBlobInfo[] = [];

  // track whether the PDF blob occupies index 0
  const hasPdfBlob = !!state.blobId;
  let pdfBlobIndex = -1;

  // step 1: build the blob list
  if (hasPdfBlob) {
    pdfBlobIndex = 0;
    allBlobs.push({
      blobId: String(state.blobId || ""),
      filename: String(state.filename || "document.pdf"),
      mime: String(state.mime || "application/pdf"),
      blake3: String(state.blake3 || ""),
      size: state.size ?? 0,
      domain: "document",
    });
  }

  const pageBlobIds = state.pageBlobIds || [];
  const pageBlake3s = state.pageBlake3s || [];
  const pageStartIndex = allBlobs.length;

  for (let i = 0; i < pageBlobIds.length; i++) {
    const pageNum = i + 1;
    allBlobs.push({
      blobId: String(pageBlobIds[i] || ""),
      filename: `page-${pageNum}.webp`,
      mime: "image/webp",
      blake3: String(pageBlake3s[i] || ""),
      size: 0,
      domain: "",
    });
  }

  if (allBlobs.length === 0) {
    console.warn(TAG, "nothing to snatch — no blobId and no pageBlobIds");
    return { pdfResult: null, pageResults: [] };
  }

  // step 2: determine probe blob.
  // prefer the first page blob that has a blake3 hash — if a peer has page 1
  // it almost certainly has all pages. fall back to the PDF blob.
  let probeBlobInfo: SnatchBlobInfo | undefined;

  for (let i = pageStartIndex; i < allBlobs.length; i++) {
    if (allBlobs[i].blake3) {
      probeBlobInfo = allBlobs[i];
      break;
    }
  }

  if (!probeBlobInfo && hasPdfBlob && allBlobs[pdfBlobIndex].blake3) {
    probeBlobInfo = allBlobs[pdfBlobIndex];
  }

  console.log(
    TAG,
    `starting batch snatch: ${hasPdfBlob ? 1 : 0} PDF blob + ${pageBlobIds.length} page blobs`,
  );

  // step 3: result accumulators
  let pdfResult: FileUploadResult | null = null;
  const pageResults: (FileUploadResult | null)[] = new Array(pageBlobIds.length).fill(null);

  const totalBlobs = allBlobs.length;
  const totalPages = pageBlobIds.length;

  // step 4: call snatchBlobBatch
  const batchOptions: BatchSnatchOptions = {
    probeBlobInfo,
    signal,
    isPeerOnline,

    onBlobComplete: (index: number, result: FileUploadResult) => {
      if (hasPdfBlob && index === pdfBlobIndex) {
        // this is the main PDF blob
        pdfResult = result;
        console.debug(TAG, "PDF blob snatched:", result.blobId.slice(0, 12));
        callbacks.onStatusText?.("PDF downloaded, snatching pages...");
      } else {
        // this is a page blob
        const pageIndex = index - pageStartIndex;
        if (pageIndex >= 0 && pageIndex < pageBlobIds.length) {
          pageResults[pageIndex] = result;
          callbacks.onPageComplete?.(pageIndex, result);
          console.debug(TAG, `page ${pageIndex + 1}/${totalPages} snatched`);
        }
      }
    },

    onProgress: (completedCount: number, totalCount: number, _blobProgress: number) => {
      // compute page-oriented progress (skip the PDF blob from the count)
      const pagesCompleted = hasPdfBlob
        ? Math.max(0, completedCount - 1)
        : completedCount;
      const pagesTotal = hasPdfBlob
        ? Math.max(0, totalCount - 1)
        : totalCount;

      if (pagesTotal > 0) {
        const progressLabel = `${pagesCompleted}/${pagesTotal}`;
        callbacks.onProgressText?.(progressLabel);

        if (pagesCompleted < pagesTotal) {
          const currentPage = pagesCompleted + 1;
          callbacks.onStatusText?.(
            `snatching page ${currentPage} of ${pagesTotal}...`,
          );
        }
      } else if (completedCount < totalCount) {
        callbacks.onProgressText?.(`${completedCount}/${totalCount}`);
        callbacks.onStatusText?.("snatching PDF...");
      }
    },
  };

  try {
    const results = await snatchBlobBatch(allBlobs, peers, batchOptions);

    // reconcile results into pdfResult / pageResults
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r) continue;

      if (hasPdfBlob && i === pdfBlobIndex) {
        pdfResult = r;
      } else {
        const pageIndex = i - pageStartIndex;
        if (pageIndex >= 0 && pageIndex < pageBlobIds.length) {
          pageResults[pageIndex] = r;
        }
      }
    }

    const successCount = results.filter((r) => r != null).length;
    console.log(
      TAG,
      `batch snatch complete: ${successCount}/${totalBlobs} blobs succeeded`,
    );
  } catch (err) {
    if (signal.aborted) {
      console.log(TAG, "batch snatch aborted");
      throw err;
    }
    console.error(TAG, "batch snatch failed:", err);
    throw err;
  }

  return { pdfResult, pageResults };
}

// ---------------------------------------------------------------------------
// savePdfToDisk
// ---------------------------------------------------------------------------

/**
 * save the main PDF blob to the user's filesystem via native save dialog.
 * thin wrapper around saveBlobToDisk from file-utils.
 */
export async function savePdfToDisk(
  blobId: string,
  filename: string,
): Promise<boolean> {
  if (!blobId) {
    console.warn(TAG, "cannot save — no blobId");
    return false;
  }

  try {
    const saved = await saveBlobToDisk(blobId, filename || "document.pdf");
    if (saved) {
      console.log(TAG, "saved PDF to disk:", blobId.slice(0, 12));
    }
    return saved;
  } catch (err) {
    console.error(TAG, "save to disk failed:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// revealPdfInFinder
// ---------------------------------------------------------------------------

/**
 * reveal the PDF blob in the OS file manager (Finder on macOS, Explorer on Windows).
 * falls back to savePdfToDisk if reveal is not available or fails.
 */
export async function revealPdfInFinder(
  blobId: string,
  filename?: string,
): Promise<boolean> {
  if (!blobId) {
    console.warn(TAG, "cannot reveal — no blobId");
    return false;
  }

  try {
    const revealed = await revealBlobInFinder(blobId);
    if (revealed) {
      return true;
    }

    // reveal not available or failed — fall back to save dialog
    console.debug(TAG, "reveal failed, falling back to save dialog");
    return savePdfToDisk(blobId, filename || "document.pdf");
  } catch (err) {
    console.warn(TAG, "reveal failed, trying save fallback:", err);
    try {
      return await savePdfToDisk(blobId, filename || "document.pdf");
    } catch (saveErr) {
      console.error(TAG, "save fallback also failed:", saveErr);
      return false;
    }
  }
}
