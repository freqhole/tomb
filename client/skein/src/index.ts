// canvas
export { emptyCanvasDoc } from "./canvas/canvas-doc";
export type { CanvasDocument, WidgetEntry } from "./canvas/canvas-doc";
export { CanvasStore } from "./canvas/canvas-store";
export { createCrashedPlaceholder } from "./canvas/crashed-placeholder";
export { initCanvas } from "./canvas/init";
export type { InitCanvasOptions, SkeinCanvas } from "./canvas/init";
export { InputRouter } from "./canvas/input-router";
export { PropertyTray } from "./canvas/property-tray";
export { Toolbar } from "./canvas/toolbar";
export { WidgetFrame } from "./canvas/widget-frame";
export type { WidgetFrameCallbacks } from "./canvas/widget-frame";
export { WidgetManager } from "./canvas/widget-manager";
export type { LiveWidget } from "./canvas/widget-manager";

// widgets
export { KeyboardDriver } from "./widgets/keyboard-driver";
export type { KeyboardHandler } from "./widgets/keyboard-driver";
export { createWidgetDoc } from "./widgets/widget-doc";
export { WidgetRegistry } from "./widgets/widget-registry";
export type {
  CompactInfo,
  PortDef,
  WidgetController,
  WidgetDoc,
  WidgetFactory,
  WidgetMetadata,
  WidgetMountContext,
  WidgetPortDeclaration,
  WidgetPropDef,
} from "./widgets/widget-types";

// p2p / social
export { resolveFriendDisplay, SqliteSocialDoc } from "./p2p/sqlite-social-doc";
export { isTauriMode } from "./p2p/tauri-transport";

// theme
export { defaultTheme } from "./theme/skein-theme";
export type { SkeinTheme } from "./theme/skein-theme";
