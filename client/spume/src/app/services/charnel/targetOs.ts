// tauri build target OS, populated once on startup via `get_build_info`
// ("macos" | "linux" | "windows" | "android" | "ios") - the reliable
// alternative to sniffing `navigator.userAgent` for "android", which android
// tauri's own webview doesn't always render honestly (see
// `getShareWebHost()`'s note on `https://tauri.localhost`). null outside
// tauri (browser builds never call `setTargetOsValue`).
//
// this module gives the rest of the app a synchronous accessor, mirroring
// `localNodeId.ts`'s pattern.

import { createSignal } from "solid-js";

const [targetOs, setTargetOs] = createSignal<string | null>(null);

/** read the cached target OS (null until charnel sets it, or always null in browser). */
export function getTargetOsValue(): string | null {
  return targetOs();
}

/** reactive accessor for solid components. */
export const targetOsSignal = targetOs;

/** charnel host populates this once on startup; browser leaves it null. */
export function setTargetOsValue(value: string | null): void {
  setTargetOs(value);
}

/** true only once the tauri host has confirmed it's building for android. */
export function isAndroidTauri(): boolean {
  return targetOs() === "android";
}
