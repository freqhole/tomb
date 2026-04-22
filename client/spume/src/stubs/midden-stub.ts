// stub for midden in Tauri builds
// midden WASM isn't needed - CharnelTransport uses app iroh via tauri IPC
//
// this stub exists so dynamic imports of "midden" don't fail during dev/build
// when VITE_CHARNEL_MODE=true

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

  proxy_admin(_peer: string, _command: string, _args: string): Promise<unknown> {
    return Promise.reject(
      new Error("midden WASM not available in Tauri - use CharnelAdminTransport"),
    );
  }
}
