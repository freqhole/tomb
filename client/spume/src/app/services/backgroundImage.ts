// background image service - allows views to set a full-page background image
import { createSignal } from "solid-js";

export interface BackgroundConfig {
  /** image URL to display as background */
  imageUrl: string;
  /** optional blur amount (default: 20px) */
  blur?: number;
  /** optional opacity of the dark overlay (default: 0.7) */
  overlayOpacity?: number;
}

const [backgroundConfig, setBackgroundConfigSignal] = createSignal<BackgroundConfig | null>(null);

export function setBackgroundImage(config: BackgroundConfig | null) {
  setBackgroundConfigSignal(config);
}

export function clearBackgroundImage() {
  setBackgroundConfigSignal(null);
}

export function getBackgroundConfig() {
  return backgroundConfig();
}
