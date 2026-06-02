// pending knocks across every p2p admin remote.
//
// reuses `KnocksSection` per remote. discovers admin remotes via the
// shared `authStatusStore` and the `whoami` role; works in both
// charnel (tauri local owner) and federated p2p modes.

import { createResource, For, Show } from "solid-js";
import { getAllRemotes } from "../../app/services/remotes/remoteManager";
import { getAuthInfo } from "../../app/services/remotes/authStatusStore";
import { whoamiForRemote } from "../../app/services/remotes/authService";
import { adminClientFor, getLocalAdminClient } from "../../app/api/adminClient";
import { isP2PRemote, type Remote } from "../../app/services/storage/schemas/remote";
import { AdminClient } from "freqhole-api-client";
import { KnocksSection } from "./knocks/KnocksSection";

interface AdminRemote {
  remote: Remote;
  client: AdminClient;
}

async function loadAdminRemotes(): Promise<AdminRemote[]> {
  const all = await getAllRemotes();
  // narrow to p2p remotes that are online; tauri charnel owner remotes are
  // also `is_charnel_managed` and skip the p2p transport, so include them.
  const candidates = all.filter(
    (r) => r.is_offline !== true && (r.is_charnel_managed || isP2PRemote(r))
  );

  const out: AdminRemote[] = [];
  await Promise.all(
    candidates.map(async (remote) => {
      try {
        // prefer cached role; fall back to a fresh whoami so the view works
        // even before the auth store has populated.
        let role = getAuthInfo(remote.remote_id)?.role;
        if (!role) {
          const me = await whoamiForRemote(remote);
          role = me.success ? me.role : undefined;
        }
        if (role !== "admin") return;
        // charnel-managed self uses the in-process admin transport — p2p
        // self-dispatch via `admin_dispatch_remote` doesn't reliably work
        // for the local node, so prefer the local client.
        const client = remote.is_charnel_managed
          ? getLocalAdminClient()
          : await adminClientFor(remote);
        if (!client) return;
        out.push({ remote, client });
      } catch {
        // remote unreachable / no admin client — skip.
      }
    })
  );
  // stable order by name
  return out.sort((a, b) => (a.remote.name ?? "").localeCompare(b.remote.name ?? ""));
}

export function PendingKnocksView() {
  const [adminRemotes, { refetch }] = createResource(loadAdminRemotes);

  return (
    <div class="p-6 max-w-5xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-[var(--color-text-primary)]">pending knocks</h1>
          <p class="text-sm text-[var(--color-text-muted)]">
            access requests across every remote where you are admin
          </p>
        </div>
        <button
          class="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-quaternary)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)] transition-colors"
          onClick={() => refetch()}
        >
          rescan remotes
        </button>
      </div>

      <Show
        when={!adminRemotes.loading}
        fallback={<div class="text-sm text-[var(--color-text-muted)]">scanning remotes...</div>}
      >
        <Show
          when={(adminRemotes() ?? []).length > 0}
          fallback={
            <div class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] p-6 text-sm text-[var(--color-text-muted)]">
              no admin remotes online. connect to a remote where you have admin role to manage its
              knock requests here.
            </div>
          }
        >
          <div class="flex flex-col gap-6">
            <For each={adminRemotes() ?? []}>
              {(entry) => (
                <div>
                  <div class="text-xs uppercase tracking-wide text-[var(--color-text-muted)] mb-2 px-1">
                    {entry.remote.name ?? entry.remote.remote_id}
                  </div>
                  <KnocksSection client={entry.client} remote={entry.remote} />
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
