import { WidgetRegistry } from "../src/widgets/widget-registry";
import { registerBinWidget } from "./bin/index";
import { canvasInfoWidget } from "./canvas-info";
import { fileWidget } from "./file";
import { imageWidget } from "./image";
import { labelWidget } from "./label";
import { markdownWidget } from "./markdown";
import { notepadWidget } from "./notepad";
import { peedeeeffWidget } from "./peedeeeff";

/**
 * a registry pre-loaded with the built-in example widgets.
 * used by the test harness and as a starting point for apps.
 */
export function createTestRegistry(): WidgetRegistry {
  const registry = new WidgetRegistry();
  registry.register(canvasInfoWidget);
  registry.register(fileWidget);
  registry.register(imageWidget);
  registry.register(labelWidget);
  registry.register(markdownWidget);
  registry.register(notepadWidget);
  registry.register(peedeeeffWidget);
  registerBinWidget(registry);
  return registry;
}

export { binSchema, binWidget, registerBinWidget } from "./bin/index";
export type { BinState } from "./bin/index";

export { canvasInfoSchema, canvasInfoWidget } from "./canvas-info";
export type { CanvasInfoState } from "./canvas-info";
export { fileSchema, fileWidget } from "./file";
export type { FileState } from "./file";
export { imageSchema, imageWidget } from "./image";
export { labelSchema, labelWidget } from "./label";
export { markdownSchema, markdownWidget } from "./markdown";
export { notepadSchema, notepadWidget } from "./notepad";
export { peedeeeffSchema, peedeeeffWidget } from "./peedeeeff";
export type { PeedeeeffState } from "./peedeeeff";
