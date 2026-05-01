// rodio playback backend (tauri-only). this is a thin wrapper that
// forwards calls to the rust rodio thread via the single
// `sibyl_call` ipc dispatcher. accepts an `IpcInvoke` adapter so this
// file never imports `@tauri-apps/api`.
//
// phase 1: rodio decodes from disk paths (mirrors dumb-player option F).
// phase 5 stretch: streaming `Read` adapter on the rust side so rodio
// can also decode the same mp3 chunk stream as webcodecs.

import type { IpcInvoke, RodioStatusPayload } from "./ipc.js";

export class RodioPlayer {
  private invoke: IpcInvoke;

  constructor(invoke: IpcInvoke) {
    this.invoke = invoke;
  }

  /** load a list of file paths into the rodio queue. */
  async loadPaths(paths: string[]): Promise<{ totalSecs: number }> {
    const r = await this.invoke({ kind: "rodio_load", paths });
    return {
      totalSecs: r.kind === "rodio_total_secs" ? r.secs : 0,
    };
  }

  async play(): Promise<void> { await this.invoke({ kind: "rodio_play" }); }
  async pause(): Promise<void> { await this.invoke({ kind: "rodio_pause" }); }
  async stop(): Promise<void> { await this.invoke({ kind: "rodio_stop" }); }
  async setVolume(v: number): Promise<void> {
    await this.invoke({ kind: "rodio_volume", v });
  }
  async seek(ms: number): Promise<void> {
    await this.invoke({ kind: "rodio_seek", ms });
  }

  async status(): Promise<RodioStatusPayload | null> {
    const r = await this.invoke({ kind: "rodio_status" });
    return r.kind === "rodio_status" ? r.status : null;
  }
}
