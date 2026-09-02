// disable_backdrop_blur (charnel config) — lets a user turn off backdrop
// blur effects (perf cost on some linux compositors) app-wide. mirrors
// backgroundImage.ts's plain signal pattern.
import { createSignal } from "solid-js";

const [disableBackdropBlur, setDisableBackdropBlurSignal] = createSignal(false);

export function setDisableBackdropBlur(disabled: boolean) {
  setDisableBackdropBlurSignal(disabled);
}

export function getDisableBackdropBlur(): boolean {
  return disableBackdropBlur();
}
