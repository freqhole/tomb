import type { Container } from "pixi.js";
import type { z } from "zod";
import type { KeyboardDriver } from "../../../src/widgets/keyboard-driver";
import type { socialSchema } from "./schema";

// ---------------------------------------------------------------------------
// social widget doc type
// ---------------------------------------------------------------------------

export type SocialState = z.infer<typeof socialSchema>;

/**
 * minimal typed facade over the social widget's automerge doc.
 * mirrors WidgetDoc but typed to socialSchema specifically.
 */
export interface SocialDoc {
  readonly current: SocialState;
  change(fn: (draft: SocialState) => void): void;
  on(event: "change", handler: (state: SocialState) => void): () => void;
}

// ---------------------------------------------------------------------------
// tab system
// ---------------------------------------------------------------------------

/**
 * shared context passed to every tab factory.
 * contains everything a tab needs to render and interact.
 */
export interface TabContext {
  /** typed social doc facade */
  doc: SocialDoc;
  /** the canvas DOM element — needed for DOM overlays (e.g. text input) */
  canvasElement: HTMLCanvasElement;
  /** keyboard driver for text input / IME */
  keyboard: KeyboardDriver;
  /** the widget's unique ID in the canvas store */
  widgetId: string;
}

/**
 * returned by each tab factory. the main social widget manages
 * visibility and positioning; the tab handles its own internals.
 */
export interface TabController {
  /** root pixi container for this tab's content */
  container: Container;
  /** re-layout within the given content bounds (width × height). */
  layout(width: number, height: number): void;
  /** tear down all resources (event listeners, textures, input handles). */
  destroy(): void;
}

/**
 * factory function signature for creating a tab.
 */
export type TabFactory = (ctx: TabContext) => TabController;
