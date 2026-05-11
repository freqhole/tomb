// hook + cache for "is the current authenticated user an admin on remote X?".
//
// admin-gated UI affordances (e.g. inline album metadata editing, bulk
// musicbrainz lookups) need a quick synchronous answer per remote without
// re-issuing whoami every render.
//
// the cache is module-scoped + invalidated when remotes are added/removed.

import { createMemo, createResource } from "solid-js";
import type { Remote } from "../../app/services/storage/schemas/remote";
import { whoamiForRemote } from "../../app/services/remotes/authService";

type RoleStatus = "unknown" | "admin" | "user" | "anonymous";

const roleCache = new Map<string, RoleStatus>();
const inflight = new Map<string, Promise<RoleStatus>>();

function classify(role?: string): RoleStatus {
  if (!role) return "anonymous";
  const r = role.toLowerCase();
  if (r === "admin" || r === "owner" || r === "superuser") return "admin";
  return "user";
}

async function loadRole(remote: Remote): Promise<RoleStatus> {
  const id = remote.remote_id;
  const existing = inflight.get(id);
  if (existing) return existing;

  const p = (async () => {
    try {
      const result = await whoamiForRemote(remote);
      const status = result.success ? classify(result.role) : "anonymous";
      roleCache.set(id, status);
      return status;
    } catch {
      roleCache.set(id, "anonymous");
      return "anonymous" as RoleStatus;
    } finally {
      inflight.delete(id);
    }
  })();
  inflight.set(id, p);
  return p;
}

export function getCachedRemoteRole(remoteId: string): RoleStatus {
  return roleCache.get(remoteId) ?? "unknown";
}

export function clearRemoteRoleCache(remoteId?: string) {
  if (remoteId) {
    roleCache.delete(remoteId);
    inflight.delete(remoteId);
  } else {
    roleCache.clear();
    inflight.clear();
  }
}

/**
 * resolves a remote's role with caching. returns a Solid resource so
 * components re-render once the role is known.
 */
export function useRemoteRole(remote: () => Remote | undefined) {
  const [role] = createResource(remote, async (r) => {
    if (!r) return "unknown" as RoleStatus;
    const cached = roleCache.get(r.remote_id);
    if (cached) return cached;
    return loadRole(r);
  });
  return role;
}

/**
 * convenience: boolean memo for "is admin on this remote?".
 * returns false while loading (callers should treat as conservative).
 */
export function useRemoteIsAdmin(remote: () => Remote | undefined) {
  const role = useRemoteRole(remote);
  return createMemo(() => role() === "admin");
}
