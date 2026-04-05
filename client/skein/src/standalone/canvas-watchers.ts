import type { DocumentId, Repo } from "@automerge/automerge-repo";
import type { CanvasDocument } from "../canvas/canvas-doc";
import { CanvasStore } from "../canvas/canvas-store";

/**
 * iterates all canvas-card widgets in the narthex, opens each linked canvas
 * document, and copies fresh metadata (title, description, lastModified,
 * color, previewUrl) into the card's per-widget doc. also handles hasUpdates
 * logic and the lastVisitedAt one-time migration for pre-schema cards.
 */
export async function syncCanvasMetadataToCards(
  repo: Repo,
  narthexStore: CanvasStore
): Promise<void> {
  const widgets = narthexStore.allWidgets();

  for (const entry of widgets) {
    if (entry.type !== "canvas-card" || !entry.docId) continue;

    try {
      // read the card's per-widget doc to get the canvasDocId
      const cardHandle = await repo.find(entry.docId as DocumentId);
      await cardHandle.whenReady();
      const cardDoc = cardHandle.doc() as Record<string, unknown> | undefined;
      if (!cardDoc?.canvasDocId || typeof cardDoc.canvasDocId !== "string") continue;

      // open the linked canvas document and read its metadata
      const canvasStore = await CanvasStore.open(repo, cardDoc.canvasDocId as DocumentId);
      const meta = canvasStore.metadata();

      // perform all updates in a single change() to avoid stale-snapshot bugs.
      // reading from the draft (d) instead of a pre-read cardDoc means the
      // hasUpdates decision sees the freshly-written metadata values.
      let changed = false;
      cardHandle.change((d: any) => {
        // sync metadata fields from the canvas doc
        if (meta.title && meta.title !== (d.title ?? "")) {
          d.title = meta.title;
          changed = true;
        }
        if (meta.description !== undefined && meta.description !== (d.description ?? "")) {
          d.description = meta.description;
          changed = true;
        }
        if (meta.lastModified && meta.lastModified !== (d.modifiedAt ?? "")) {
          d.modifiedAt = meta.lastModified;
          changed = true;
        }
        // sync color from canvas doc (0 means "not set" -- skip to keep card's own default)
        if (meta.color && meta.color !== (d.color ?? 0)) {
          d.color = meta.color;
          changed = true;
        }
        // sync previewUrl from canvas doc
        if (meta.previewUrl !== undefined && meta.previewUrl !== (d.previewUrl ?? "")) {
          d.previewUrl = meta.previewUrl;
          changed = true;
        }

        // seed lastVisitedAt for pre-migration cards (one-time migration).
        // without this, cards created before the schema migration have
        // lastVisitedAt = "" which causes:
        //   - stuck update pills on shared canvases (any lastModified > "")
        //   - missing pills on owned canvases (sync skips empty lastVisitedAt)
        const lastVisited = (d.lastVisitedAt as string) || "";
        if (!lastVisited && meta.lastModified) {
          d.lastVisitedAt = meta.lastModified;
          changed = true;
          // after seeding, this canvas is "caught up" -- no update pill
          if (d.hasUpdates) {
            d.hasUpdates = false;
          }
          return;
        }

        // set or clear hasUpdates using the live draft values
        if (meta.lastModified && lastVisited && meta.lastModified > lastVisited) {
          d.hasUpdates = true;
          d.lastKnownModifiedAt = meta.lastModified;
          changed = true;
        } else if (meta.lastModified && lastVisited && meta.lastModified <= lastVisited) {
          if (d.hasUpdates) {
            d.hasUpdates = false;
            changed = true;
          }
        }
      });

      if (changed) {
        console.log("[skein] synced metadata to canvas-card:", entry.id);
      }
    } catch (err) {
      // if a canvas doc isn't reachable, skip silently
      console.warn("[skein] failed to sync metadata for card:", entry.id, err);
    }
  }
}

/**
 * watches all canvas docs linked from narthex cards for remote changes.
 * when a canvas doc's lastModified changes (via automerge sync), marks
 * the card with hasUpdates so the update dot appears.
 *
 * returns an array of unsubscribe functions -- the caller is responsible
 * for invoking them when watchers should be torn down.
 */
export async function watchCanvasDocsForUpdates(
  repo: Repo,
  narthexStore: CanvasStore
): Promise<Array<() => void>> {
  const unsubs: Array<() => void> = [];
  const widgets = narthexStore.allWidgets();

  for (const entry of widgets) {
    if (entry.type !== "canvas-card" || !entry.docId) continue;
    const cardDocId = entry.docId;

    try {
      const cardHandle = await repo.find<any>(cardDocId as DocumentId);
      await cardHandle.whenReady();
      const cardDoc = cardHandle.doc() as Record<string, unknown> | undefined;
      if (!cardDoc?.canvasDocId || typeof cardDoc.canvasDocId !== "string") continue;

      const canvasDocId = cardDoc.canvasDocId as string;

      // open the canvas doc and watch for changes
      let canvasHandle: any;
      try {
        canvasHandle = repo.find<CanvasDocument>(canvasDocId as DocumentId);
      } catch {
        continue; // canvas not available
      }

      let lastSeenModified = (cardDoc.modifiedAt as string) || "";

      const onChange = () => {
        const canvasDoc = canvasHandle.doc() as CanvasDocument | undefined;
        if (!canvasDoc?.lastModified) return;
        if (canvasDoc.lastModified === lastSeenModified) return;
        lastSeenModified = canvasDoc.lastModified;

        // don't mark as updated if user is currently viewing this canvas
        const currentHash = window.location.hash.slice(1);
        if (currentHash === canvasDocId) return;

        // read the card's lastVisitedAt from the per-widget doc
        const currentCardDoc = cardHandle.doc() as Record<string, unknown> | undefined;
        const lastVisited = (currentCardDoc?.lastVisitedAt as string) || "";

        // guard: if lastVisitedAt was never set (pre-migration card), skip.
        // without this, any lastModified > "" is always true, causing stuck pills.
        if (!lastVisited) return;

        if (canvasDoc.lastModified > lastVisited) {
          cardHandle.change((draft: any) => {
            draft.hasUpdates = true;
            draft.lastKnownModifiedAt = canvasDoc.lastModified;
            draft.modifiedAt = canvasDoc.lastModified;
          });
        }
      };

      canvasHandle.on("change", onChange);
      unsubs.push(() => {
        canvasHandle.off("change", onChange);
      });
    } catch {
      // skip unavailable docs
    }
  }

  return unsubs;
}
