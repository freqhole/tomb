// reactive pin store, extracted from App.tsx so both the UI and the
// accept-loop's pairing handler can read/regenerate the current pin
// without importing solid component code.

import { createSignal } from "solid-js";
import { generatePin } from "./pin";

const [pin, setPin] = createSignal(generatePin());

/** current pairing pin (reactive - safe to call from a solid component). */
export const currentPin = pin;

/** generate + set a new pairing pin, invalidating the old one immediately. */
export function regeneratePin(): string {
  const next = generatePin();
  setPin(next);
  return next;
}
