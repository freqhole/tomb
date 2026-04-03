import { WidgetRegistry } from "../src/widgets/widget-registry";
import { counterWidget } from "./counter";
import { helloWorldWidget } from "./hello-world";

/**
 * a registry pre-loaded with the built-in example widgets.
 * used by the test harness and as a starting point for apps.
 */
export function createTestRegistry(): WidgetRegistry {
  const registry = new WidgetRegistry();
  registry.register(helloWorldWidget);
  registry.register(counterWidget);
  return registry;
}

export { counterSchema, counterWidget } from "./counter";
export { helloWorldWidget } from "./hello-world";

