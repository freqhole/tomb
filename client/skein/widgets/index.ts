import { WidgetRegistry } from "../src/widgets/widget-registry";
import { counterWidget } from "./counter";
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
  registry.register(helloWorldWidget);
  registry.register(counterWidget);
  registry.register(imageWidget);
  registry.register(labelWidget);
  registry.register(markdownWidget);
  registry.register(notepadWidget);
  return registry;
}

export { counterSchema, counterWidget } from "./counter";
export { helloWorldWidget } from "./hello-world";
export { imageSchema, imageWidget } from "./image";
export { labelSchema, labelWidget } from "./label";
export { markdownSchema, markdownWidget } from "./markdown";
export { notepadSchema, notepadWidget } from "./notepad";
