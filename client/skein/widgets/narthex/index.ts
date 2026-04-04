import { WidgetRegistry } from "../../src/widgets/widget-registry";
import { labelWidget } from "../label";
import { canvasCardWidget } from "./canvas-card";
import { canvasWizardWidget } from "./canvas-wizard";
import { friendsWidget } from "./friends-widget";
import { profileWidget } from "./profile-widget";

/**
 * a registry pre-loaded with the narthex (home screen) widgets.
 * the narthex uses the same canvas system but with a limited set
 * of widgets — just canvas cards for navigation and labels for grouping.
 */
export function createNarthexRegistry(): WidgetRegistry {
  const registry = new WidgetRegistry();
  registry.register(canvasCardWidget);
  registry.register(canvasWizardWidget);
  registry.register(profileWidget);
  registry.register(friendsWidget);
  registry.register(labelWidget);
  return registry;
}

export { canvasCardSchema, canvasCardWidget } from "./canvas-card";
export { canvasWizardSchema, canvasWizardWidget } from "./canvas-wizard";
export { friendsSchema, friendsWidget } from "./friends-widget";
export { profileSchema, profileWidget } from "./profile-widget";
