// upload domain methods for FreqholeClient
// uses transport.upload() for FormData handling

import { z } from "zod";
import type { Transport } from "../transport.js";
import type { SafeParseResult } from "./types.js";
import {
  MusicUploadResponseSchema,
  ImageUploadResponseSchema,
} from "../codegen/schema.js";
import type * as s from "../codegen/schema.js";

// helper to parse response and validate with schema
function parseResponse<T>(
  responseBody: string,
  status: number,
  schema: z.ZodType<T>,
): SafeParseResult<T> {
  if (status >= 400) {
    let errorMessage = `HTTP ${status}`;
    try {
      const errorBody = JSON.parse(responseBody);
      if (errorBody?.error) {
        errorMessage = `HTTP ${status}: ${errorBody.error}`;
      }
    } catch {
      // body wasn't JSON
    }
    return {
      success: false,
      error: new z.ZodError([{ code: "custom", path: [], message: errorMessage }]),
    };
  }

  try {
    const json = JSON.parse(responseBody);
    const data = json.data ?? json;
    const result = schema.safeParse(data);
    if (result.success) {
      return { success: true, data: result.data };
    } else {
      return { success: false, error: result.error };
    }
  } catch (err) {
    return {
      success: false,
      error: new z.ZodError([
        { code: "custom", path: [], message: err instanceof Error ? err.message : "parse error" },
      ]),
    };
  }
}

export type UploadImageOptions = {
  /** optionally associate the image with an entity (album, playlist, song, artist, etc.) */
  associate?: s.AssociationHint;
};

export function createUploadMethods(transport: Transport) {
  return {
    /**
     * upload a music file
     * returns job information for async processing
     */
    music: async (file: File | Blob): Promise<SafeParseResult<s.MusicUploadResponse>> => {
      const formData = new FormData();
      formData.append("file", file);

      const response = await transport.upload("/api/upload/music", formData);
      return parseResponse(response.body, response.status, MusicUploadResponseSchema);
    },

    /**
     * upload an image file
     * optionally associate with an entity (album, playlist, song, artist)
     */
    image: async (
      file: File | Blob,
      options?: UploadImageOptions,
    ): Promise<SafeParseResult<s.ImageUploadResponse>> => {
      const formData = new FormData();
      formData.append("file", file);

      if (options?.associate) {
        formData.append("associate_with", JSON.stringify(options.associate));
      }

      const response = await transport.upload("/api/upload/image", formData);
      return parseResponse(response.body, response.status, ImageUploadResponseSchema);
    },
  };
}

export type UploadMethods = ReturnType<typeof createUploadMethods>;
