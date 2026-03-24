// current state signals - separate file to avoid circular deps
// shared between data/index.ts and data/remote/remoteSource.ts

import { createSignal } from "solid-js";
import type { UserRoleName, TransportType } from "../../app/api/client";

// current remote info (for display and client creation)
export interface CurrentRemoteInfo {
  remote_id: string;
  name: string;
  base_url?: string; // empty for P2P remotes
  api_key?: string;
  transport_type?: TransportType;
  peer_addr?: string; // for P2P remotes
  is_charnel_managed?: boolean; // true if managed by tauri (use IPC dispatch)
}

const [currentRemote, setCurrentRemote] = createSignal<CurrentRemoteInfo | null>(null);

// get current remote info (null if using local)
export function getCurrentRemote(): CurrentRemoteInfo | null {
  return currentRemote();
}

// set current remote (used by data/index.ts when switching sources)
export function setCurrentRemoteState(remote: CurrentRemoteInfo | null): void {
  setCurrentRemote(remote);
}

// current authenticated user info (per remote)
export interface CurrentUser {
  userId: string;
  username: string;
  role: UserRoleName;
}

const [currentUser, setCurrentUser] = createSignal<CurrentUser | null>(null);

// get the current authenticated user (null if not connected to remote or not authenticated)
export function getCurrentUser(): CurrentUser | null {
  return currentUser();
}

// set current user (used by data/index.ts when authenticating)
export function setCurrentUserState(user: CurrentUser | null): void {
  setCurrentUser(user);
}
