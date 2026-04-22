// pick the storage backend at runtime: sqlite in tauri (charnel app), idb
// in the browser. both impls share the RemoteBackend interface so callers
// don't need to branch.

import { isCharnelMode } from "../../charnel/mode";
import { idbBackend } from "./idbBackend";
import { sqliteBackend } from "./sqliteBackend";
import type { RemoteBackend } from "./types";

export function getBackend(): RemoteBackend {
  return isCharnelMode() ? sqliteBackend : idbBackend;
}

export type { RemoteBackend } from "./types";
