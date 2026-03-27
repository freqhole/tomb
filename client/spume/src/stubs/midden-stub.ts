// stub for midden in Tauri builds
// midden WASM isn't needed - CharnelTransport uses app iroh via tauri IPC
//
// this stub exists so dynamic imports of "midden" don't fail during dev/build
// when VITE_CHARNEL_MODE=true

export class GossipSender {
  async broadcast(_message: Uint8Array): Promise<void> {
    throw new Error("midden WASM not available in Tauri - use CharnelTransport");
  }
}

export class GossipReceiver {
  async recv(): Promise<any> {
    throw new Error("midden WASM not available in Tauri - use CharnelTransport");
  }
}

export class GossipHandle {
  take_sender(): GossipSender {
    throw new Error("midden WASM not available in Tauri - use CharnelTransport");
  }
  take_receiver(): GossipReceiver {
    throw new Error("midden WASM not available in Tauri - use CharnelTransport");
  }
}

export class MiddenNode {
  static async create(): Promise<MiddenNode> {
    throw new Error("midden WASM not available in Tauri - use CharnelTransport");
  }

  static async create_from_key(_key: Uint8Array): Promise<MiddenNode> {
    throw new Error("midden WASM not available in Tauri - use CharnelTransport");
  }

  node_id(): string {
    throw new Error("midden WASM not available in Tauri - use CharnelTransport");
  }

  secret_key(): Uint8Array {
    throw new Error("midden WASM not available in Tauri - use CharnelTransport");
  }

  async gossip_join(_topic_hex: string, _bootstrap_peers_json: string): Promise<GossipHandle> {
    throw new Error("midden WASM not available in Tauri - use CharnelTransport");
  }

  async gossip_subscribe(_topic_hex: string, _bootstrap_peers_json: string): Promise<GossipHandle> {
    throw new Error("midden WASM not available in Tauri - use CharnelTransport");
  }
}
