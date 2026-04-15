// federation backup — export/import P2P identity + remote configs
//
// encoding: essential fields → JSON → deflate-raw → base64url
// zero external dependencies — uses browser-native CompressionStream.

import { getP2PIdentity, saveP2PIdentity, getAllPendingRemotes, createPendingRemote, initAppDB } from "../../app/services/storage/db";
import { getAllRemotes } from "../../app/services/remotes/remoteManager";
import type { Remote, P2PRemote, HttpRemote } from "../../app/services/storage/schemas/remote";
import { STORE_REMOTES, type PendingRemote } from "../../app/services/storage/types";

// ============================================================================
// backup shape — only the fields needed to restore identity + connections
// ============================================================================

interface BackupPayload {
  // version tag for future format changes
  v: 1;
  // P2P identity (secret key as base64, node_id for validation)
  k?: string; // secret_key base64
  n?: string; // node_id
  // remotes — stripped to connection essentials
  r?: BackupRemote[];
  // pending remotes — stripped to peer addr + stage
  p?: BackupPendingRemote[];
}

interface BackupRemote {
  i: string;  // remote_id
  n: string;  // name
  t: string;  // transport
  a?: string; // peer_addr (P2P)
  u?: string; // base_url (HTTP)
  k?: string; // api_key
}

interface BackupPendingRemote {
  a: string;  // peer_addr
  t: string;  // transport
  s: string;  // stage
  n?: string; // server_name
}

// ============================================================================
// export
// ============================================================================

export async function exportFederationBackup(): Promise<string> {
  const [identity, remotes, pendingRemotes] = await Promise.all([
    getP2PIdentity(),
    getAllRemotes(),
    getAllPendingRemotes(),
  ]);

  const payload: BackupPayload = { v: 1 };

  // identity
  if (identity) {
    payload.k = uint8ToBase64(identity.secret_key);
    payload.n = identity.node_id;
  }

  // remotes — strip to essentials, skip charnel-managed
  const exportableRemotes = remotes.filter((r) => !r.is_charnel_managed);
  if (exportableRemotes.length > 0) {
    payload.r = exportableRemotes.map(minifyRemote);
  }

  // pending remotes — only keep ones with useful state
  const exportablePending = pendingRemotes.filter(
    (p) => p.stage === "knock_pending" || p.stage === "knock_accepted" || p.stage === "connected"
  );
  if (exportablePending.length > 0) {
    payload.p = exportablePending.map(minifyPendingRemote);
  }

  const json = JSON.stringify(payload);
  const compressed = await deflate(new TextEncoder().encode(json));
  return uint8ToBase64Url(compressed);
}

// ============================================================================
// import
// ============================================================================

export interface ImportResult {
  identityRestored: boolean;
  remotesAdded: number;
  pendingAdded: number;
  skippedRemotes: string[];
}

export async function importFederationBackup(encoded: string): Promise<ImportResult> {
  const compressed = base64UrlToUint8(encoded.trim());
  const jsonBytes = await inflate(compressed);
  const payload: BackupPayload = JSON.parse(new TextDecoder().decode(jsonBytes));

  if (payload.v !== 1) {
    throw new Error(`unsupported backup version: ${payload.v}`);
  }

  const result: ImportResult = {
    identityRestored: false,
    remotesAdded: 0,
    pendingAdded: 0,
    skippedRemotes: [],
  };

  // restore identity (only if not already set)
  if (payload.k) {
    const existing = await getP2PIdentity();
    if (!existing) {
      const secretKey = base64ToUint8(payload.k);
      if (secretKey.length !== 32) {
        throw new Error("invalid secret key length");
      }
      const nodeId = payload.n ?? "";
      await saveP2PIdentity(secretKey, nodeId);
      result.identityRestored = true;
    }
  }

  // restore remotes (skip duplicates by remote_id or peer_addr)
  if (payload.r && payload.r.length > 0) {
    const db = await initAppDB();
    const existingRemotes = await getAllRemotes();
    const existingIds = new Set(existingRemotes.map((r) => r.remote_id));
    const existingAddrs = new Set(
      existingRemotes
        .filter((r): r is Remote & { peer_addr: string } => "peer_addr" in r && !!r.peer_addr)
        .map((r) => r.peer_addr)
    );

    for (const br of payload.r) {
      if (existingIds.has(br.i)) {
        result.skippedRemotes.push(br.n);
        continue;
      }
      if (br.a && existingAddrs.has(br.a)) {
        result.skippedRemotes.push(br.n);
        continue;
      }

      try {
        const now = Date.now();
        const commonFields = {
          remote_id: br.i,
          name: br.n,
          is_active: false,
          last_connected_at: null,
          created_at: now,
          updated_at: now,
          description: null,
          image_url: null,
          image_blob_id: null,
          version: null,
          last_info_check: null,
          api_key: br.k,
        };

        const remote: Remote = br.a
          ? { ...commonFields, transport: (br.t as "wasm" | "app") || "wasm", peer_addr: br.a, base_url: br.u } as P2PRemote
          : { ...commonFields, transport: "http" as const, base_url: br.u ?? "" } as HttpRemote;

        await db.put(STORE_REMOTES, remote);
        result.remotesAdded++;
      } catch {
        result.skippedRemotes.push(br.n);
      }
    }
  }

  // restore pending remotes (skip duplicates by peer_addr)
  if (payload.p && payload.p.length > 0) {
    const existingPending = await getAllPendingRemotes();
    const existingAddrs = new Set(existingPending.map((p) => p.peer_addr));

    for (const bp of payload.p) {
      if (existingAddrs.has(bp.a)) continue;
      try {
        await createPendingRemote({
          peer_addr: bp.a,
          transport: bp.t as PendingRemote["transport"],
          stage: bp.s as PendingRemote["stage"],
          server_name: bp.n ?? null,
          server_description: null,
          server_version: null,
          server_image_data: null,
          server_image_type: null,
          knock_username: null,
          knock_message: null,
          error_message: null,
        });
        result.pendingAdded++;
      } catch {
        // skip silently
      }
    }
  }

  return result;
}

// ============================================================================
// compression (browser-native deflate-raw via CompressionStream)
// ============================================================================

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(data.slice());
  writer.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(data.slice());
  writer.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

// ============================================================================
// base64 / base64url helpers (no padding, url-safe alphabet)
// ============================================================================

function uint8ToBase64(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ToBase64Url(data: Uint8Array): string {
  return uint8ToBase64(data)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlToUint8(b64url: string): Uint8Array {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  // add padding
  while (b64.length % 4 !== 0) b64 += "=";
  return base64ToUint8(b64);
}

// ============================================================================
// minify helpers — strip to connection-essential fields
// ============================================================================

function minifyRemote(r: Remote): BackupRemote {
  const br: BackupRemote = {
    i: r.remote_id,
    n: r.name,
    t: r.transport,
  };
  if ("peer_addr" in r && r.peer_addr) br.a = r.peer_addr;
  if (r.base_url) br.u = r.base_url;
  if (r.api_key) br.k = r.api_key;
  return br;
}

function minifyPendingRemote(p: PendingRemote): BackupPendingRemote {
  const bp: BackupPendingRemote = {
    a: p.peer_addr,
    t: p.transport,
    s: p.stage,
  };
  if (p.server_name) bp.n = p.server_name;
  return bp;
}
