import { WidgetRegistry } from "../src/widgets/widget-registry";
import { canvasInfoWidget } from "./canvas-info";
import { counterWidget } from "./counter";
import { fileWidget } from "./file";
import { helloWorldWidget } from "./hello-world";
import { imageWidget } from "./image";
import { labelWidget } from "./label";
import { markdownWidget } from "./markdown";
import { notepadWidget } from "./notepad";

/**
 * a registry pre-loaded with the built-in example widgets.
 * used by the test harness and as a starting point for apps.
 */
export function createTestRegistry(): WidgetRegistry {
  const registry = new WidgetRegistry();
  registry.register(canvasInfoWidget);
  registry.register(helloWorldWidget);
  registry.register(counterWidget);
  registry.register(fileWidget);
  registry.register(imageWidget);
  registry.register(labelWidget);
  registry.register(markdownWidget);
  registry.register(notepadWidget);
  return registry;
}

export { canvasInfoSchema, canvasInfoWidget } from "./canvas-info";
export type { CanvasInfoState } from "./canvas-info";
export { counterSchema, counterWidget } from "./counter";
export { fileSchema, fileWidget } from "./file";
export type { FileState } from "./file";
export { helloWorldWidget } from "./hello-world";
export { imageSchema, imageWidget } from "./image";
export { labelSchema, labelWidget } from "./label";
export { markdownSchema, markdownWidget } from "./markdown";
export { notepadSchema, notepadWidget } from "./notepad";

