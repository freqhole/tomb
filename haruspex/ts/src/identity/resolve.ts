import { identitySourceAvailable, readIdentityFrom, writeIdentityTo } from "./idbStore.js";
import type { IdentitySource } from "./idbStore.js";
import type { IdentityStore, P2PIdentity } from "./types.js";

export interface ResolveIdentityOptions {
  /**
   * other apps' databases to check first, read-only - never created or
   * upgraded. checked in order; the first source with a stored identity
   * wins over the local store. this is how, e.g., a newly-installed app can
   * pick up an identity an already-installed sibling app created for this
   * origin, without either app depending on the other's schema beyond the
   * shared identity record shape.
   */
  fallbackSources?: IdentitySource[];
}

/**
 * resolve the p2p identity for this origin.
 *
 * checks each fallback source in order (without creating any of them), then
 * falls back to the local store. the first fallback source that already has
 * an identity wins over the local store, even if the local store also has
 * one - this lets a newly-added app adopt an existing sibling app's identity
 * on first run.
 */
export async function resolveIdentity(
  local: IdentityStore,
  options: ResolveIdentityOptions = {},
): Promise<P2PIdentity | null> {
  for (const source of options.fallbackSources ?? []) {
    if (!(await identitySourceAvailable(source))) continue;
    const identity = await readIdentityFrom(source);
    if (identity) return identity;
    // source exists but has no identity yet - keep checking the remaining
    // sources, then fall through to local
  }

  return local.get();
}

/**
 * persist a p2p identity.
 *
 * writes to the first available fallback source (matching resolveIdentity's
 * preference order); otherwise writes to the local store.
 */
export async function persistIdentity(
  identity: P2PIdentity,
  local: IdentityStore,
  options: ResolveIdentityOptions = {},
): Promise<void> {
  for (const source of options.fallbackSources ?? []) {
    if (await identitySourceAvailable(source)) {
      await writeIdentityTo(source, identity);
      return;
    }
  }

  await local.set(identity);
}
