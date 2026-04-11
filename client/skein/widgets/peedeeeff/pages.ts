import { Assets, Sprite, Texture } from "pixi.js";
import { getFullBlobDataUrl, getLocalBlobUrl } from "../../src/widgets/file-utils";
import type { PageSlot } from "./types";

/**
 * create a page texture cache that manages loading, caching, and cleanup
 * of page image textures for the peedeeeff widget.
 */
export function createPageCache() {
  const cache = new Map<number, PageSlot>();

  function destroySlot(slot: PageSlot): void {
    if (slot.abort) {
      slot.abort.abort();
      slot.abort = null;
    }
    if (slot.sprite) {
      if (slot.sprite.parent) {
        slot.sprite.parent.removeChild(slot.sprite);
      }
      slot.sprite.destroy();
      slot.sprite = null;
    }
    if (slot.assetKey) {
      Assets.unload(slot.assetKey);
      if (slot.assetKey.startsWith("blob:")) {
        URL.revokeObjectURL(slot.assetKey);
      }
      slot.assetKey = "";
    }
    // for textures created directly (e.g. from ImageBitmap), destroy explicitly
    if (slot.texture && !slot.assetKey) {
      slot.texture.destroy(true);
    }
    slot.texture = null;
    slot.state = "empty";
  }

  /**
   * load (or return cached) texture for a given page index.
   * resolves blob ID to a local URL via getLocalBlobUrl + getFullBlobDataUrl.
   * passes blake3 for cross-peer resolution.
   */
  async function loadPageTexture(
    pageIndex: number,
    blobId: string,
    blake3?: string
  ): Promise<PageSlot> {
    // check if already loaded with same blobId
    let slot = cache.get(pageIndex);
    if (slot && slot.state === "loaded" && (slot.assetKey || slot.texture)) {
      return slot;
    }

    if (slot) destroySlot(slot);

    slot = {
      state: "loading",
      texture: null,
      sprite: null,
      assetKey: "",
      abort: new AbortController(),
    };
    cache.set(pageIndex, slot);

    if (!blobId) {
      slot.state = "empty";
      return slot;
    }

    const abort = slot.abort!;

    try {
      // resolve blob ID to a loadable URL (pass blake3 for cross-peer resolution)
      let resolvedUrl = await getLocalBlobUrl(blobId, blake3);
      if (!resolvedUrl) {
        // fall back to full blob data URL (no peers — page blobs are local)
        resolvedUrl = await getFullBlobDataUrl(blobId);
      }

      if (!resolvedUrl || abort.signal.aborted) {
        slot.state = "error";
        return slot;
      }

      let texture: Texture;
      let assetKey: string;

      if (resolvedUrl.startsWith("data:") || resolvedUrl.startsWith("asset:")) {
        texture = await Assets.load<Texture>(resolvedUrl);
        assetKey = resolvedUrl;
      } else {
        const response = await fetch(resolvedUrl, { signal: abort.signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        // revoke the incoming blob URL now that we've fetched its data
        if (resolvedUrl.startsWith("blob:")) {
          URL.revokeObjectURL(resolvedUrl);
        }
        // bypass PixiJS asset loader — it can't determine file type from blob URLs
        const imageBitmap = await createImageBitmap(blob);
        texture = Texture.from(imageBitmap);
        assetKey = ""; // no Assets cache entry — cleanup handled by texture.destroy
      }

      if (abort.signal.aborted) {
        if (assetKey) {
          Assets.unload(assetKey);
          if (assetKey.startsWith("blob:")) {
            URL.revokeObjectURL(assetKey);
          }
        } else if (texture) {
          texture.destroy(true);
        }
        return slot;
      }

      slot.texture = texture;
      slot.assetKey = assetKey;
      slot.sprite = new Sprite(texture);
      slot.state = "loaded";
      return slot;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return slot;
      }
      slot.state = "error";
      return slot;
    }
  }

  function get(pageIndex: number): PageSlot | undefined {
    return cache.get(pageIndex);
  }

  function clear(): void {
    for (const [, slot] of cache) destroySlot(slot);
    cache.clear();
  }

  function destroy(): void {
    clear();
  }

  function entries(): IterableIterator<[number, PageSlot]> {
    return cache.entries();
  }

  return { loadPageTexture, destroySlot, get, clear, destroy, entries };
}

export type PageCacheHandle = ReturnType<typeof createPageCache>;
