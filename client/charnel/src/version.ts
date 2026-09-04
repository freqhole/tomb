// project version - keep in sync with workspace version in Cargo.toml
// updated via `make bump-version VERSION=x.y.z`
export const VERSION = "0.3.2";

// git short sha this ui bundle was built from (injected by vite.config.ts)
declare const __UI_GIT_SHA__: string;
export const UI_GIT_SHA = typeof __UI_GIT_SHA__ === "string" ? __UI_GIT_SHA__ : "unknown";
