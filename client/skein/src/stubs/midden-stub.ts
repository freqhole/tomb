// stub for midden in Tauri builds
// midden WASM isn't needed in skein when building for Tauri
//
// this stub exists so dynamic imports of "midden" don't fail during dev/build
// when VITE_TAURI is set

export class MiddenNode {
  static async create(): Promise<MiddenNode> {
    throw new Error("midden WASM is not available in this build");
  }

  static async create_from_key(_key: Uint8Array): Promise<MiddenNode> {
    throw new Error("midden WASM is not available in this build");
  }

  static async create_with_alpns(_key: Uint8Array, _extra_alpns: string[]): Promise<MiddenNode> {
    throw new Error("midden WASM is not available in this build");
  }

  node_id(): string {
    throw new Error("midden WASM is not available in this build");
  }

  secret_key(): Uint8Array {
    throw new Error("midden WASM is not available in this build");
  }

  async open_bi(_peer_addr: string, _alpn: string): Promise<never> {
    throw new Error("midden WASM is not available in this build");
  }

  async accept(): Promise<never> {
    throw new Error("midden WASM is not available in this build");
  }
}
