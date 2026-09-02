// player node bootstrap: creates (or restores) this device's midden/iroh
// identity, registers the pairing/control ALPN, and starts accepting
// inbound connections.
//
// identity persistence reuses @freqhole/haruspex's idb-backed identity
// store (same shape spume persists its own identity with), rather than
// rolling a bespoke indexeddb schema for this site.

import { MiddenNode, MiddenNodeOptions } from "@freqhole/midden";
import {
  createIdbIdentityStore,
  resolveIdentity,
  persistIdentity,
} from "@freqhole/haruspex/identity";

// dedicated ALPN for player pairing (trust handshake) + control (play/queue/etc)
// commands, separate from freqhole-admin/1 (which assumes an already-trusted,
// full grimoire-admin relationship).
export const PLAYER_ALPN = "freqhole-player/1";

// midden registers this on every node by default (see lib/midden/src/lib.rs) -
// it's the ALPN spume's regular "add remote" flow probes for server info.
export const FREQHOLE_ALPN = "freqhole/1";

const IDB_DATABASE_NAME = "freqhole_player";
const IDB_STORE_NAME = "identity";

const identityStore = createIdbIdentityStore({
  databaseName: IDB_DATABASE_NAME,
  storeName: IDB_STORE_NAME,
});

let node: MiddenNode | null = null;
let nodePromise: Promise<MiddenNode> | null = null;

/** get or create the player's midden node singleton. */
export async function getPlayerNode(): Promise<MiddenNode> {
  if (node) return node;
  if (nodePromise) return nodePromise;

  nodePromise = (async (): Promise<MiddenNode> => {
    const existing = await resolveIdentity(identityStore);

    const options = new MiddenNodeOptions();
    options.extra_alpns = [PLAYER_ALPN];

    let created: MiddenNode;
    if (existing) {
      options.secret_key = existing.secret_key;
      created = await MiddenNode.create_with_options(options);
    } else {
      created = await MiddenNode.create_with_options(options);
      await persistIdentity(
        {
          secret_key: created.secret_key(),
          node_id: created.node_id(),
          created_at: Date.now(),
        },
        identityStore,
      );
    }

    // NOTE: deliberately do NOT call created.start_blob_server() here.
    // node.accept() (driven by acceptLoop.ts) already handles incoming
    // iroh-blobs connections internally before returning anything to JS -
    // calling both would race two independent accept loops for the same
    // incoming connections, and start_blob_server()'s loop silently drops
    // any non-iroh-blobs ALPN (like our own freqhole-player/1) it wins
    // that race for. see lib/midden/src/lib.rs's accept()/start_blob_server()
    // doc comments.

    node = created;
    return created;
  })();

  return nodePromise;
}

/** true once the player node has finished initializing. */
export function isPlayerNodeReady(): boolean {
  return node !== null;
}
