// upload domain methods for FreqholeClient
// uses transport.upload() for FormData handling

import { z } from "zod";
import type * as s from "../codegen/schema.js";
import {
  ImageUploadResponseSchema,
  MusicImportResponseSchema,
  MusicUploadResponseSchema,
} from "../codegen/schema.js";
import type { Transport } from "../transport.js";
import type { SafeParseResult } from "./types.js";

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
      error: new z.ZodError([
        { code: "custom", path: [], message: errorMessage },
      ]),
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
        {
          code: "custom",
          path: [],
          message: err instanceof Error ? err.message : "parse error",
        },
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
    music: async (
      file: File | Blob,
    ): Promise<SafeParseResult<s.MusicUploadResponse>> => {
      const formData = new FormData();
      formData.append("file", file);

      const response = await transport.upload("/api/upload/music", formData);
      return parseResponse(
        response.body,
        response.status,
        MusicUploadResponseSchema,
      );
    },

    /**
     * upload a music file by filesystem path (tauri P2P only).
     * imports the file into the local iroh-blobs store, then tells the remote
     * peer to pull it via verified streaming.
     * requires transport.uploadByPath to be implemented (CharnelTransport).
     */
    musicByPath: async (
      filePath: string,
    ): Promise<SafeParseResult<s.MusicUploadResponse>> => {
      if (!transport.uploadByPath) {
        return {
          success: false,
          error: new z.ZodError([
            {
              code: "custom",
              path: [],
              message: "uploadByPath not supported by this transport",
            },
          ]),
        };
      }

      const response = await transport.uploadByPath(
        "/api/upload/music",
        filePath,
      );
      return parseResponse(
        response.body,
        response.status,
        MusicUploadResponseSchema,
      );
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
      return parseResponse(
        response.body,
        response.status,
        ImageUploadResponseSchema,
      );
    },

    /**
     * upload an image by filesystem path (tauri-local only)
     * bypasses base64 encoding by passing path directly to backend
     * requires transport.uploadByPath to be implemented
     */
    imageByPath: async (
      filePath: string,
      options?: UploadImageOptions,
    ): Promise<SafeParseResult<s.ImageUploadResponse>> => {
      if (!transport.uploadByPath) {
        return {
          success: false,
          error: new z.ZodError([
            {
              code: "custom",
              path: [],
              message: "uploadByPath not supported by this transport",
            },
          ]),
        };
      }

      const metadata: Record<string, unknown> = {};
      if (options?.associate) {
        metadata.associate_with = options.associate;
      }

      const response = await transport.uploadByPath(
        "/api/upload/image",
        filePath,
        metadata,
      );
      return parseResponse(
        response.body,
        response.status,
        ImageUploadResponseSchema,
      );
    },

    /**
     * import music files by filesystem paths (tauri-local only)
     * accepts file paths or directory paths (directories are scanned recursively)
     * bypasses file transfer since files are already local
     * requires transport.request to be implemented (uses POST with JSON body)
     *
     * @param paths - array of file or directory paths to import
     * @param options - optional settings
     * @param options.waitForCompletion - if true, wait for all jobs to complete (up to 5 min)
     */
    musicByPaths: async (
      paths: string[],
      options?: { waitForCompletion?: boolean },
    ): Promise<SafeParseResult<s.MusicImportResponse>> => {
      const body = {
        paths,
        wait_for_completion: options?.waitForCompletion ?? false,
      };

      const response = await transport.request(
        "POST",
        "/api/upload/music-paths",
        JSON.stringify(body),
      );
      return parseResponse(
        response.body,
        response.status,
        MusicImportResponseSchema,
      );
    },
  };
}

export type UploadMethods = ReturnType<typeof createUploadMethods>;
