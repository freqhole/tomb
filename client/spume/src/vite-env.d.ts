/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to "true" when running in Tauri app context */
  readonly VITE_CHARNEL_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** App version from git commit SHA, injected at build time */
declare const __APP_VERSION__: string;

/** true when built for charnel (Tauri), injected at build time */
declare const __IS_CHARNEL__: boolean;

/** the rust target triple's OS tauri is building for ("android" | "ios" |
 *  "macos" | "linux" | "windows"), injected at build time - see
 *  vite.config.ts's `mapTargetTripleToOs`. null outside tauri (plain
 *  web/PWA builds). */
declare const __TAURI_TARGET_OS__: string | null;
