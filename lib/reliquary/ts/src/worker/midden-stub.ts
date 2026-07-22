// stub for midden in builds that don't need its wasm module (e.g. a
// tauri build, where native code handles iroh/blob work instead).
//
// this stub exists so a bundler alias for the "midden" module (e.g. vite's
// `resolve.alias: { midden: "@freqhole/reliquary/worker" }`) resolves to
// something during dev/build without requiring a real wasm binary. every
// method throws - callers in a build that aliases to this stub shouldn't
// be calling it at all.

export class MiddenNode {
  static async create(): Promise<MiddenNode> {
    throw new Error("midden wasm is not available in this build");
  }

  static async create_from_key(_key: Uint8Array): Promise<MiddenNode> {
    throw new Error("midden wasm is not available in this build");
  }

  static async create_with_alpns(_key: Uint8Array, _extra_alpns: string[]): Promise<MiddenNode> {
    throw new Error("midden wasm is not available in this build");
  }

  node_id(): string {
    throw new Error("midden wasm is not available in this build");
  }

  secret_key(): Uint8Array {
    throw new Error("midden wasm is not available in this build");
  }

  async open_bi(_peer_addr: string, _alpn: string): Promise<never> {
    throw new Error("midden wasm is not available in this build");
  }

  async accept(): Promise<never> {
    throw new Error("midden wasm is not available in this build");
  }
}
