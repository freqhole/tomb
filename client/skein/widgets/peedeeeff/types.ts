import type { Sprite, Texture } from "pixi.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------

export const peedeeeffSchema = z.object({
  blobId: z.string().default(""),
  filename: z.string().default(""),
  mime: z.string().default(""),
  blake3: z.string().default(""),
  size: z.number().default(0),
  pageCount: z.number().default(0),
  pageBlobIds: z.array(z.string()).default([]),
  pageBlake3s: z.array(z.string()).default([]),
  currentPage: z.number().default(0),
  pagesPerView: z.number().default(1),
  syncPage: z.boolean().default(true),
  background: z.number().default(0xffffff),
});

export type PeedeeeffState = z.infer<typeof peedeeeffSchema>;

// ---------------------------------------------------------------------------
// page loading
// ---------------------------------------------------------------------------

export type PageLoadState = "empty" | "loading" | "loaded" | "error";
export type ActionState = "checking" | "local" | "remote" | "snatching" | "snatched";

export interface PageSlot {
  state: PageLoadState;
  texture: Texture | null;
  sprite: Sprite | null;
  assetKey: string;
  abort: AbortController | null;
}

// ---------------------------------------------------------------------------
// nav constants
// ---------------------------------------------------------------------------

export const NAV_BTN_W = 32;
export const NAV_BTN_H = 48;
export const NAV_BTN_RADIUS = 6;
export const NAV_HIDE_DELAY = 1200;
export const GO_START_SIZE = 26;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
