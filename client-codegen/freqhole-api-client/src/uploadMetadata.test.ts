// tests for the typed `UploadMetadata` param on `Transport.upload()` (see
// docs/add-media-review-refactor-plan.md §6 in the tomb repo).
//
// previously, "review before send" target info and the image
// `associate_with` hint were smuggled through FormData string fields that
// every non-HTTP transport had to parse back out. now they're a plain typed
// object passed as `upload()`'s 4th argument - only `HttpTransport` (whose
// wire format actually is multipart form fields) converts it back to
// FormData internally.

import { describe, expect, it, vi } from "vitest";
import { HttpTransport } from "./transport.js";
import { createUploadMethods } from "./domains/upload.js";
import type { Transport, TransportResponse, UploadMetadata } from "./transport.js";

function okResponse(data: unknown): TransportResponse {
  return { status: 200, body: JSON.stringify({ success: true, data }) };
}

describe("HttpTransport.upload metadata -> FormData", () => {
  it("folds associate_with and target_remote_id/name into real form fields", async () => {
    let capturedFormData: FormData | undefined;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      capturedFormData = init.body as FormData;
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const transport = new HttpTransport("https://example.test");
    const formData = new FormData();
    formData.append("file", new Blob(["x"]), "song.mp3");
    const metadata: UploadMetadata = {
      associate_with: {
        entity_type: "album",
        entity_id: "abc",
      } as UploadMetadata["associate_with"],
      target_remote_id: "remote-1",
      target_remote_name: "my server",
    };

    await transport.upload("/api/upload/music", formData, undefined, metadata);

    expect(capturedFormData).toBeDefined();
    expect(capturedFormData!.get("target_remote_id")).toBe("remote-1");
    expect(capturedFormData!.get("target_remote_name")).toBe("my server");
    expect(JSON.parse(capturedFormData!.get("associate_with") as string)).toEqual({
      entity_type: "album",
      entity_id: "abc",
    });

    vi.unstubAllGlobals();
  });

  it("omits fields entirely when no metadata is passed", async () => {
    let capturedFormData: FormData | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedFormData = init.body as FormData;
        return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
      }),
    );

    const transport = new HttpTransport("https://example.test");
    const formData = new FormData();
    formData.append("file", new Blob(["x"]), "song.mp3");

    await transport.upload("/api/upload/music", formData);

    expect(capturedFormData!.get("target_remote_id")).toBeNull();
    expect(capturedFormData!.get("target_remote_name")).toBeNull();
    expect(capturedFormData!.get("associate_with")).toBeNull();

    vi.unstubAllGlobals();
  });
});

describe("domains/upload.ts music()/image() metadata passthrough", () => {
  it("music() passes targetRemoteId/targetRemoteName as typed metadata, not FormData fields", async () => {
    let receivedFormData: FormData | undefined;
    let receivedMetadata: UploadMetadata | undefined;
    const fakeTransport: Pick<Transport, "upload"> = {
      upload: async (_path, formData, _onProgress, metadata) => {
        receivedFormData = formData;
        receivedMetadata = metadata;
        return okResponse({ job_id: "job-1" });
      },
    };

    const upload = createUploadMethods(fakeTransport as Transport);
    await upload.music(new Blob(["x"]), undefined, {
      targetRemoteId: "remote-1",
      targetRemoteName: "my server",
    });

    expect(receivedMetadata).toEqual({
      target_remote_id: "remote-1",
      target_remote_name: "my server",
    });
    // the send-target fields must NOT be smuggled into FormData anymore -
    // only the file itself belongs there.
    expect(receivedFormData!.get("target_remote_id")).toBeNull();
    expect(receivedFormData!.get("target_remote_name")).toBeNull();
  });

  it("music() passes no metadata when no send target is given", async () => {
    let receivedMetadata: UploadMetadata | undefined = { target_remote_id: "should-be-cleared" };
    const fakeTransport: Pick<Transport, "upload"> = {
      upload: async (_path, _formData, _onProgress, metadata) => {
        receivedMetadata = metadata;
        return okResponse({ job_id: "job-1" });
      },
    };

    const upload = createUploadMethods(fakeTransport as Transport);
    await upload.music(new Blob(["x"]));

    expect(receivedMetadata).toBeUndefined();
  });

  it("image() passes associate_with as typed metadata, not a FormData field", async () => {
    let receivedFormData: FormData | undefined;
    let receivedMetadata: UploadMetadata | undefined;
    const fakeTransport: Pick<Transport, "upload"> = {
      upload: async (_path, formData, _onProgress, metadata) => {
        receivedFormData = formData;
        receivedMetadata = metadata;
        return okResponse({ blob_id: "blob-1" });
      },
    };

    const upload = createUploadMethods(fakeTransport as Transport);
    const associate = {
      entity_type: "album",
      entity_id: "abc",
    } as UploadMetadata["associate_with"];
    await upload.image(new Blob(["x"]), { associate });

    expect(receivedMetadata).toEqual({ associate_with: associate });
    expect(receivedFormData!.get("associate_with")).toBeNull();
  });
});
