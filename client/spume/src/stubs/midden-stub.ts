// stub for midden in Tauri builds
// midden WASM isn't needed - TauriTransport uses app iroh via tauri IPC
//
// this stub exists so dynamic imports of "midden" don't fail during dev/build
// when VITE_TAURI_MODE=true

export class MiddenNode {
  static async create(): Promise<MiddenNode> {
    throw new Error("midden WASM not available in Tauri - use TauriTransport");
  }

  static async create_from_key(_key: Uint8Array): Promise<MiddenNode> {
    throw new Error("midden WASM not available in Tauri - use TauriTransport");
  }

  node_id(): string {
    throw new Error("midden WASM not available in Tauri - use TauriTransport");
  }

  secret_key(): Uint8Array {
    throw new Error("midden WASM not available in Tauri - use TauriTransport");
  }
}
