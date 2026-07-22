// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { pickImageAsDataUrl, resizeImageToDataUrl } from "./image-utils.js";

// happy-dom provides `document` and the File/Blob constructors, but not canvas
// rasterization (OffscreenCanvas, createImageBitmap) - no environment does that
// without native bindings. these fakes stand in for the browser's actual image
// decode/encode pipeline so the surrounding sizing/cropping/error-handling logic
// gets real coverage without a native canvas dependency.

class FakeImageBitmap {
  constructor(
    public width: number,
    public height: number
  ) {}
  close = vi.fn();
}

class FakeOffscreenCanvasContext {
  drawImage = vi.fn();
}

class FakeOffscreenCanvas {
  static instances: FakeOffscreenCanvas[] = [];
  context = new FakeOffscreenCanvasContext();
  convertToBlobResult: Blob | null = new Blob(["fake-encoded-bytes"], { type: "image/webp" });

  constructor(
    public width: number,
    public height: number
  ) {
    FakeOffscreenCanvas.instances.push(this);
  }

  getContext(): FakeOffscreenCanvasContext {
    return this.context;
  }

  async convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob> {
    if (!this.convertToBlobResult) throw new Error("encode failed");
    return new Blob(["fake-encoded-bytes"], { type: options?.type ?? "image/webp" });
  }
}

function installCanvasFakes(bitmapSize: { width: number; height: number }): void {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => new FakeImageBitmap(bitmapSize.width, bitmapSize.height))
  );
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas as unknown as typeof OffscreenCanvas);
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeOffscreenCanvas.instances = [];
});

describe("resizeImageToDataUrl", () => {
  it("returns null when OffscreenCanvas/createImageBitmap are unavailable", async () => {
    const result = await resizeImageToDataUrl(new Blob(["x"], { type: "image/png" }));
    expect(result).toBeNull();
  });

  it("returns a data url with the requested (default) mime type", async () => {
    installCanvasFakes({ width: 400, height: 300 });
    const result = await resizeImageToDataUrl(new Blob(["x"], { type: "image/png" }));
    expect(result).toMatch(/^data:image\/webp;base64,/);
  });

  it("downscales to fit within maxWidth/maxHeight while preserving aspect ratio", async () => {
    installCanvasFakes({ width: 400, height: 200 });
    await resizeImageToDataUrl(new Blob(["x"]), { maxWidth: 100, maxHeight: 100 });

    const canvas = FakeOffscreenCanvas.instances[0];
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(50);
  });

  it("does not upscale images smaller than the max bounds", async () => {
    installCanvasFakes({ width: 50, height: 40 });
    await resizeImageToDataUrl(new Blob(["x"]), { maxWidth: 200, maxHeight: 200 });

    const canvas = FakeOffscreenCanvas.instances[0];
    expect(canvas.width).toBe(50);
    expect(canvas.height).toBe(40);
  });

  it("center-crops to a square when cropSquare is set", async () => {
    installCanvasFakes({ width: 400, height: 200 });
    await resizeImageToDataUrl(new Blob(["x"]), { cropSquare: true, maxWidth: 200, maxHeight: 200 });

    const canvas = FakeOffscreenCanvas.instances[0];
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(200);
    expect(canvas.context.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      100, // sx: (400 - 200) / 2
      0, // sy: (200 - 200) / 2
      200, // sw
      200, // sh
      0,
      0,
      200,
      200
    );
  });

  it("passes the requested mime type and quality through to the encoder", async () => {
    installCanvasFakes({ width: 100, height: 100 });
    const result = await resizeImageToDataUrl(new Blob(["x"]), {
      mime: "image/jpeg",
      quality: 0.5,
    });
    expect(result).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("closes the decoded bitmap even when encoding succeeds", async () => {
    installCanvasFakes({ width: 100, height: 100 });
    const bitmaps: FakeImageBitmap[] = [];
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        const bmp = new FakeImageBitmap(100, 100);
        bitmaps.push(bmp);
        return bmp;
      })
    );

    await resizeImageToDataUrl(new Blob(["x"]));
    expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
  });

  it("returns null and still closes the bitmap when getContext returns null", async () => {
    installCanvasFakes({ width: 100, height: 100 });
    const bitmaps: FakeImageBitmap[] = [];
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        const bmp = new FakeImageBitmap(100, 100);
        bitmaps.push(bmp);
        return bmp;
      })
    );
    vi.spyOn(FakeOffscreenCanvas.prototype, "getContext").mockReturnValueOnce(
      null as unknown as FakeOffscreenCanvasContext
    );

    const result = await resizeImageToDataUrl(new Blob(["x"]));
    expect(result).toBeNull();
    expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
  });

  it("returns null when createImageBitmap rejects (e.g. non-image input)", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("not an image");
      })
    );
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas as unknown as typeof OffscreenCanvas);

    const result = await resizeImageToDataUrl(new Blob(["not an image"]));
    expect(result).toBeNull();
  });
});

describe("pickImageAsDataUrl", () => {
  function captureInput(): { getInput: () => HTMLInputElement } {
    let captured: HTMLInputElement | null = null;
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreateElement(tag);
      if (tag === "input") captured = el as HTMLInputElement;
      return el;
    });
    return {
      getInput: () => {
        if (!captured) throw new Error("input was never created");
        return captured;
      },
    };
  }

  it("resolves with the resized data url when a file is chosen", async () => {
    installCanvasFakes({ width: 100, height: 100 });
    const { getInput } = captureInput();

    const promise = pickImageAsDataUrl();
    const input = getInput();
    const file = new File(["x"], "photo.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));

    const result = await promise;
    expect(result).toMatch(/^data:image\/webp;base64,/);
  });

  it("resolves with null when the picker is cancelled", async () => {
    const { getInput } = captureInput();

    const promise = pickImageAsDataUrl();
    const input = getInput();
    input.dispatchEvent(new Event("cancel"));

    const result = await promise;
    expect(result).toBeNull();
  });

  it("resolves with null when the change event fires with no file selected", async () => {
    const { getInput } = captureInput();

    const promise = pickImageAsDataUrl();
    const input = getInput();
    Object.defineProperty(input, "files", { value: [], configurable: true });
    input.dispatchEvent(new Event("change"));

    const result = await promise;
    expect(result).toBeNull();
  });

  it("removes the temporary input element after resolving", async () => {
    const { getInput } = captureInput();

    const promise = pickImageAsDataUrl();
    const input = getInput();
    expect(document.body.contains(input)).toBe(true);
    input.dispatchEvent(new Event("cancel"));
    await promise;

    expect(document.body.contains(input)).toBe(false);
  });
});
