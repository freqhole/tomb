// reactive pin store, extracted so both a host app's UI and the
// accept-loop's pairing handler can read/regenerate the current pin
// without importing any solid component code.
import { createSignal } from "solid-js";
import { generatePin } from "./pin";
const [pin, setPin] = createSignal(generatePin());
/** current pairing pin (reactive - safe to call from a solid component). */
export const currentPin = pin;
/** generate + set a new pairing pin, invalidating the old one immediately. */
export function regeneratePin() {
    const next = generatePin();
    setPin(next);
    return next;
}
