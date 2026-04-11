import { WidgetRegistry } from "../../src/widgets/widget-registry";
import { registerBinWidget } from "../bin/index";
import { labelWidget } from "../label";
import { markdownWidget } from "../markdown";

import { canvasCardWidget } from "./canvas-card";
import { canvasWizardWidget } from "./canvas-wizard";
import { joinCanvasWidget } from "./join-canvas";
import { messagezWidget } from "./messagez-widget";
import { socialWidget } from "./social/social-widget";
import { registerTrashWidget } from "./trash-widget";

/**
 * a registry pre-loaded with the narthex (home screen) widgets.
 * the narthex uses the same canvas system but with a limited set
 * of widgets — just canvas cards for navigation and labels for grouping.
 */
export function createNarthexRegistry(): WidgetRegistry {
  const registry = new WidgetRegistry();
  registry.register(canvasCardWidget);
  registry.register(canvasWizardWidget);
  registry.register(joinCanvasWidget);
  registry.register(socialWidget);
  registry.register(messagezWidget);
  registry.register(labelWidget);
  registry.register(markdownWidget);
  registerBinWidget(registry);
  registerTrashWidget(registry);
  return registry;
}

export { markdownSchema, markdownWidget } from "../markdown";
export { canvasCardSchema, canvasCardWidget } from "./canvas-card";
export { canvasWizardSchema, canvasWizardWidget } from "./canvas-wizard";
export { joinCanvasSchema, joinCanvasWidget } from "./join-canvas";
export { messagezSchema, messagezWidget } from "./messagez-widget";
export { socialSchema, socialWidget } from "./social";
export type { FriendEntry, FriendNodeId, SocialState } from "./social";
