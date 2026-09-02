// stub for midden in Tauri builds
// midden WASM isn't needed - CharnelTransport uses app iroh via tauri IPC
//
// this stub exists so dynamic imports of "@freqhole/midden" don't fail during dev/build
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
      new Error("midden WASM not available in Tauri - use CharnelAdminTransport")
    );
  }

  static async create_with_options(_options: MiddenNodeOptions): Promise<MiddenNode> {
    throw new Error("midden WASM not available in Tauri - use CharnelTransport");
  }
}

// real class has `extra_alpns`/`secret_key`/etc setters backed by wasm-bindgen
// getters/setters - plain public fields are enough here since every caller
// only ever runs through create_with_options above, which always throws.
export class MiddenNodeOptions {
  connect_timeout_ms?: number;
  extra_alpns?: string[];
  opfs_store_dir?: string;
  secret_key?: Uint8Array;
}
