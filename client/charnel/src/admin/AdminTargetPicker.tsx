// admin target picker
//
// dropdown shown in the wizard sidebar / header. lists "local" plus every
// row in the `remotez` registry that has a P2P peer_addr (the only kind we
// can actually admin over `freqhole-admin/1`).
//
// switching targets just calls `setCurrent(...)` on the AdminTransportContext
// — every view that calls `useAdminTransport().dispatch(...)` retargets
// automatically.
//
// see docs/wizard-remote-admin.md.

import { createSignal, onMount, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import {
  useAdminTransport,
  LOCAL_TARGET,
  type AdminTargetInfo,
} from "./context";
import { dispatch as adminDispatch } from "./transport";

interface Remote {
  remote_id: string;
  name: string;
  transport: "http" | "wasm" | "app";
  peer_addr: string | null;
  is_active: boolean;
  is_offline: boolean | null;
}

function shortPeerAddr(peerAddr: string): string {
  // node ids are 64 hex chars; everything else (json) just gets first 8
  const trimmed = peerAddr.trim();
  if (trimmed.startsWith("{")) return "endpoint";
  return trimmed.length > 16
    ? `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`
    : trimmed;
}

export function AdminTargetPicker() {
  const transport = useAdminTransport();
  const [remotes, setRemotes] = createSignal<Remote[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // add-remote inline form state
  const [showAdd, setShowAdd] = createSignal(false);
  const [addName, setAddName] = createSignal("");
  const [addPeerAddr, setAddPeerAddr] = createSignal("");
  const [adding, setAdding] = createSignal(false);
  const [addError, setAddError] = createSignal<string | null>(null);
  const [addNotice, setAddNotice] = createSignal<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<Remote[]>("remotez_list");
      // only P2P-capable remotes are admin-eligible
      setRemotes(result.filter((r) => r.transport !== "http" && r.peer_addr));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  onMount(load);

  function onChange(value: string) {
    if (value === "local") {
      transport.setCurrent(LOCAL_TARGET);
      return;
    }
    const r = remotes().find((r) => r.remote_id === value);
    if (!r || !r.peer_addr) return;
    const target: AdminTargetInfo = {
      kind: "remote",
      label: r.name || shortPeerAddr(r.peer_addr),
      peerAddr: r.peer_addr,
      shortId: shortPeerAddr(r.peer_addr),
    };
    transport.setCurrent(target);
  }

  const currentValue = () => {
    const c = transport.current();
    if (c.kind === "local") return "local";
    // match by peer_addr to a remote_id
    const match = remotes().find((r) => r.peer_addr === c.peerAddr);
    return match?.remote_id ?? "local";
  };

  function resetAddForm() {
    setAddName("");
    setAddPeerAddr("");
    setAddError(null);
    setAddNotice(null);
  }

  async function onAddSubmit(e: Event) {
    e.preventDefault();
    const name = addName().trim();
    const peerAddr = addPeerAddr().trim();
    if (!peerAddr) {
      setAddError("peer address (node id) is required");
      return;
    }
    if (!name) {
      setAddError("name is required");
      return;
    }
    setAdding(true);
    setAddError(null);
    setAddNotice(null);
    try {
      // dedup against existing peer_addr first
      const existing = await invoke<Remote | null>("remotez_get_by_peer_addr", {
        peerAddr,
      });
      let row: Remote;
      if (existing) {
        row = existing;
        setAddNotice("remote already exists; selecting it");
      } else {
        row = await invoke<Remote>("remotez_upsert", {
          request: {
            remote_id: crypto.randomUUID(),
            name,
            transport: "app",
            base_url: null,
            peer_addr: peerAddr,
            api_key: null,
            is_active: false,
            is_charnel_managed: true,
            last_connected_at: null,
            description: null,
            image_url: null,
            image_blob_id: null,
            version: null,
            last_info_check: null,
            is_offline: null,
            offline_since: null,
            last_checked: null,
            metadata: null,
          },
        });
      }
      await load();
      // switch active target to the new/existing remote
      const target: AdminTargetInfo = {
        kind: "remote",
        label: row.name || shortPeerAddr(peerAddr),
        peerAddr,
        shortId: shortPeerAddr(peerAddr),
      };
      transport.setCurrent(target);
      // verify reachability + admin role via server_info
      setAddNotice("verifying admin access…");
      const verify = await adminDispatch<Record<string, unknown>>(
        "server_info",
        {},
        { kind: "remote", peerAddr },
      );
      if (verify.success) {
        setAddNotice("connected. admin verified.");
        resetAddForm();
        setShowAdd(false);
      } else {
        setAddError(
          `connected but verification failed: ${verify.message || "unknown"}`,
        );
      }
    } catch (e) {
      setAddError(String(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div class="admin-target-picker">
      <label class="admin-target-label" for="admin-target-select">
        managing
      </label>
      <select
        id="admin-target-select"
        class="admin-target-select"
        value={currentValue()}
        onChange={(e) => onChange(e.currentTarget.value)}
        disabled={loading()}
      >
        <option value="local">local</option>
        <For each={remotes()}>
          {(r) => (
            <option value={r.remote_id}>
              {r.name || "(unnamed)"}
              {r.is_offline ? " (offline?)" : ""}
            </option>
          )}
        </For>
      </select>
      <Show when={error()}>
        <div class="admin-target-error">{error()}</div>
      </Show>
      <Show
        when={showAdd()}
        fallback={
          <button
            type="button"
            class="admin-target-add-toggle"
            onClick={() => setShowAdd(true)}
          >
            + add remote
          </button>
        }
      >
        <form class="admin-target-add-form" onSubmit={onAddSubmit}>
          <input
            type="text"
            class="admin-target-add-input"
            placeholder="name"
            value={addName()}
            onInput={(e) => setAddName(e.currentTarget.value)}
            disabled={adding()}
          />
          <input
            type="text"
            class="admin-target-add-input"
            placeholder="node id (peer addr)"
            value={addPeerAddr()}
            onInput={(e) => setAddPeerAddr(e.currentTarget.value)}
            disabled={adding()}
          />
          <div class="admin-target-add-actions">
            <button
              type="submit"
              class="admin-target-add-submit"
              disabled={adding()}
            >
              {adding() ? "adding…" : "add"}
            </button>
            <button
              type="button"
              class="admin-target-add-cancel"
              onClick={() => {
                resetAddForm();
                setShowAdd(false);
              }}
              disabled={adding()}
            >
              cancel
            </button>
          </div>
          <Show when={addError()}>
            <div class="admin-target-error">{addError()}</div>
          </Show>
          <Show when={addNotice() && !addError()}>
            <div class="admin-target-notice">{addNotice()}</div>
          </Show>
        </form>
      </Show>
    </div>
  );
}

/** scope banner shown across the top of admin pages when a remote target
 * is active. for local targets this renders nothing. */
export function AdminScopeBanner() {
  const transport = useAdminTransport();

  return (
    <Show when={transport.isRemote()}>
      <div
        class="admin-scope-banner"
        classList={{
          [`admin-scope-${transport.status()}`]: true,
        }}
        role="status"
      >
        <span class="admin-scope-icon">⌁</span>
        <span class="admin-scope-text">
          managing remote: <strong>{transport.current().label}</strong>
          <Show when={transport.current().shortId}>
            {" "}
            <span class="admin-scope-id">({transport.current().shortId})</span>
          </Show>
          {" — "}
          <span class="admin-scope-status">{transport.status()}</span>
          <Show when={transport.statusError()}>
            {" "}
            <span class="admin-scope-status-detail">
              ({transport.statusError()})
            </span>
          </Show>
        </span>
        <button
          type="button"
          class="admin-scope-disconnect"
          onClick={() => transport.setCurrent(LOCAL_TARGET)}
        >
          back to local
        </button>
      </div>
    </Show>
  );
}
