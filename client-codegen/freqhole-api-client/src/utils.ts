// url helpers and upload utilities

import { routes } from "./codegen/routes.js";
import { z } from "zod";
import type { SafeParseResult } from "./client.js";
import * as s from "./codegen/schema.js";

// url helper functions - return urls for resources without making fetch calls
// these are useful for <audio src={...}>, <img src={...}>, etc.

/**
 * get the streaming url for a blob (audio file)
 * use this in <audio src={...}> or for direct downloads
 */
export function getBlobUrl(baseUrl: string, blobId: string): string {
  return `${baseUrl}/api/blobs/${blobId}`;
}

/**
 * get the metadata endpoint url for a blob
 */
export function getBlobMetadataUrl(baseUrl: string, blobId: string): string {
  return `${baseUrl}/api/blobs/${blobId}/metadata`;
}

/**
 * get the url for a playlist by id
 * note: this returns the api endpoint url, not a streaming url
 */
export function getPlaylistUrl(baseUrl: string, playlistId: string): string {
  return `${baseUrl}/api/music/playlists/${playlistId}`;
}

/**
 * get the url for a fetch job by id
 */
export function getFetchJobUrl(baseUrl: string, jobId: string): string {
  return `${baseUrl}/api/music/fetch/${jobId}`;
}

// upload utilities - handle FormData for file uploads

/**
 * upload an image file
 * returns the blob id and url for the uploaded image
 */
export async function uploadImage(
  baseUrl: string,
  file: File | Blob,
  apiKey?: string,
): Promise<SafeParseResult<z.infer<typeof s.ImageUploadResponseSchema>>> {
  const formData = new FormData();
  formData.append("file", file);

  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(`${baseUrl}/api/upload/image`, {
      method: "POST",
      headers: headers,
      body: formData,
      credentials: apiKey ? "omit" : "include",
    });

    if (!response.ok) {
      return {
        success: false,
        error: new z.ZodError([
          {
            code: "custom",
            path: [],
            message: `HTTP ${response.status}: ${response.statusText}`,
          },
        ]),
      };
    }

    const json = await response.json();
    const data = json.data ?? json;

    const result = s.ImageUploadResponseSchema.safeParse(data);
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
          message: err instanceof Error ? err.message : "network error",
        },
      ]),
    };
  }
}

/**
 * upload a music file
 * returns job information for the upload processing
 */
export async function uploadMusic(
  baseUrl: string,
  file: File | Blob,
  apiKey?: string,
): Promise<SafeParseResult<z.infer<typeof s.MusicUploadResponseSchema>>> {
  const formData = new FormData();
  formData.append("file", file);

  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(`${baseUrl}/api/upload/music`, {
      method: "POST",
      headers: headers,
      body: formData,
      credentials: apiKey ? "omit" : "include",
    });

    if (!response.ok) {
      return {
        success: false,
        error: new z.ZodError([
          {
            code: "custom",
            path: [],
            message: `HTTP ${response.status}: ${response.statusText}`,
          },
        ]),
      };
    }

    const json = await response.json();
    const data = json.data ?? json;

    const result = s.MusicUploadResponseSchema.safeParse(data);
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
          message: err instanceof Error ? err.message : "network error",
        },
      ]),
    };
  }
}

// blob metadata fetch helper - fetches metadata as json
export async function fetchBlobMetadata(
  baseUrl: string,
  blobId: string,
  apiKey?: string,
): Promise<SafeParseResult<any>> {
  const headers: Record<string, string> = {};
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(getBlobMetadataUrl(baseUrl, blobId), {
      method: "GET",
      headers: headers,
      credentials: apiKey ? "omit" : "include",
    });

    if (!response.ok) {
      return {
        success: false,
        error: new z.ZodError([
          {
            code: "custom",
            path: [],
            message: `HTTP ${response.status}: ${response.statusText}`,
          },
        ]),
      };
    }

    const json = await response.json();
    const data = json.data ?? json;

    return { success: true, data: data };
  } catch (err) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: "custom",
          path: [],
          message: err instanceof Error ? err.message : "network error",
        },
      ]),
    };
  }
}
