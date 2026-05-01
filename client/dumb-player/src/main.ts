import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
// note: webkitgtk doesn't expose OfflineAudioContext in workers, so D
// decodes on the main thread. the AudioWorklet still runs on the dedicated
// rt audio thread, which is the actual stutter-resilience win.

const pickBtn = document.querySelector<HTMLButtonElement>("#pick-btn")!;
const blobBtn = document.querySelector<HTMLButtonElement>("#play-blob-btn")!;
const mseBtn = document.querySelector<HTMLButtonElement>("#play-mse-btn")!;
const waBtn = document.querySelector<HTMLButtonElement>("#play-webaudio-btn")!;
const workletBtn = document.querySelector<HTMLButtonElement>("#play-worklet-btn")!;
const bigBufBtn = document.querySelector<HTMLButtonElement>("#play-bigbuf-btn")!;
const rodioBtn = document.querySelector<HTMLButtonElement>("#play-rodio-btn")!;
const rodioControls = document.querySelector<HTMLDivElement>("#rodio-controls")!;
const rodioPauseBtn = document.querySelector<HTMLButtonElement>("#rodio-pause-btn")!;
const rodioResumeBtn = document.querySelector<HTMLButtonElement>("#rodio-resume-btn")!;
const rodioSeekInput = document.querySelector<HTMLInputElement>("#rodio-seek-input")!;
const rodioSeekBtn = document.querySelector<HTMLButtonElement>("#rodio-seek-btn")!;
const rodioVolInput = document.querySelector<HTMLInputElement>("#rodio-vol-input")!;
const rodioStatus = document.querySelector<HTMLSpanElement>("#rodio-status")!;
const waControls = document.querySelector<HTMLDivElement>("#wa-controls")!;
const waStatus = document.querySelector<HTMLSpanElement>("#wa-status")!;
const stopBtn = document.querySelector<HTMLButtonElement>("#stop-btn")!;
const copyLogBtn = document.querySelector<HTMLButtonElement>("#copy-log-btn")!;
const clearLogBtn = document.querySelector<HTMLButtonElement>("#clear-log-btn")!;
const audio = document.querySelector<HTMLAudioElement>("#audio")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const log = document.querySelector<HTMLPreElement>("#log")!;

let pickedBytes: Uint8Array | null = null;
// list of all paths the user picked. modes a-e use only the first; mode f
// queues all of them gaplessly via rodio's sink.append.
let pickedPaths: string[] = [];
let pickedMime = "audio/mpeg";
let currentBlobUrl: string | null = null;
let mediaSource: MediaSource | null = null;

// shared web audio state (used by C and D)
let audioCtx: AudioContext | null = null;
let waSource: AudioBufferSourceNode | null = null;
let waBuffer: AudioBuffer | null = null;
let workletNode: AudioWorkletNode | null = null;
let workletReady = false;
// option E uses its own AudioContext so we can request a wider output buffer
// without disturbing C/D's context. only used by mode E.
let bigBufCtx: AudioContext | null = null;
let bigBufSource: AudioBufferSourceNode | null = null;

// shared web-audio playback state for the on-screen status line (modes c/d/e).
// each mode sets this when it starts so a single poll loop can render position.
interface WaPlayback {
  label: string;
  ctx: AudioContext;
  startedAtCtxTime: number;
  duration: number; // seconds; 0 if unknown
}
let waPlayback: WaPlayback | null = null;
let waPollTimer: number | null = null;

function stopWaPolling() {
  if (waPollTimer != null) {
    clearInterval(waPollTimer);
    waPollTimer = null;
  }
}

function startWaPolling() {
  stopWaPolling();
  const render = () => {
    if (!waPlayback) {
      waStatus.textContent = "idle";
      return;
    }
    const elapsed = waPlayback.ctx.currentTime - waPlayback.startedAtCtxTime;
    const state = waPlayback.ctx.state;
    const dur = waPlayback.duration > 0 ? `${waPlayback.duration.toFixed(1)}s` : "?";
    waStatus.textContent = `${waPlayback.label} | ${state} | ${elapsed.toFixed(1)}s / ${dur}`;
  };
  render();
  waPollTimer = window.setInterval(render, 250);
}

function logLine(msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  log.textContent = `[${ts}] ${msg}\n` + log.textContent;
  // note: do NOT console.log from here, or installConsoleMirror would loop.
}

// mirror console.{log,info,warn,error,debug} to the on-page logger so
// devtools-only output (errors from worklets, decode-worker, fetch, etc) shows
// up in the log we can copy to the clipboard.
function installConsoleMirror() {
  const levels = ["log", "info", "warn", "error", "debug"] as const;
  for (const level of levels) {
    const orig = (console as any)[level].bind(console);
    (console as any)[level] = (...args: any[]) => {
      orig(...args);
      try {
        const text = args
          .map((a) => {
            if (typeof a === "string") return a;
            if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? "\n" + a.stack : ""}`;
            try { return JSON.stringify(a); } catch { return String(a); }
          })
          .join(" ");
        const ts = new Date().toISOString().slice(11, 23);
        const tag = level === "log" ? "" : `[${level}] `;
        log.textContent = `[${ts}] ${tag}${text}\n` + log.textContent;
      } catch {
        // never let mirroring break the app
      }
    };
  }
  // also catch unhandled errors / promise rejections that bypass console
  window.addEventListener("error", (e) => {
    const ts = new Date().toISOString().slice(11, 23);
    log.textContent = `[${ts}] [window.error] ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}\n` + log.textContent;
  });
  window.addEventListener("unhandledrejection", (e) => {
    const ts = new Date().toISOString().slice(11, 23);
    const reason = e.reason instanceof Error ? `${e.reason.name}: ${e.reason.message}` : String(e.reason);
    log.textContent = `[${ts}] [unhandledrejection] ${reason}\n` + log.textContent;
  });
}
installConsoleMirror();

copyLogBtn.addEventListener("click", async () => {
  const text = log.textContent ?? "";
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      // fallback: execCommand("copy") via a hidden textarea
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    const orig = copyLogBtn.textContent;
    copyLogBtn.textContent = "copied!";
    setTimeout(() => { copyLogBtn.textContent = orig; }, 1200);
  } catch (e) {
    logLine(`copy failed: ${e}`);
  }
});

clearLogBtn.addEventListener("click", () => {
  log.textContent = "";
});

function mimeFromExt(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "mp3": return "audio/mpeg";
    case "flac": return "audio/flac";
    case "ogg": return "audio/ogg";
    case "opus": return "audio/ogg; codecs=opus";
    case "wav": return "audio/wav";
    case "m4a":
    case "aac": return "audio/mp4";
    default: return "application/octet-stream";
  }
}

[
  "loadstart", "loadedmetadata", "loadeddata", "canplay", "canplaythrough",
  "play", "pause", "playing", "waiting", "stalled", "suspend",
  "ended", "error", "emptied",
].forEach((ev) => {
  audio.addEventListener(ev, () => {
    const buffered =
      audio.buffered.length > 0
        ? `${audio.buffered.start(0).toFixed(2)}-${audio
            .buffered.end(audio.buffered.length - 1)
            .toFixed(2)}`
        : "none";
    logLine(`<audio> ${ev} (t=${audio.currentTime.toFixed(2)} buf=${buffered})`);
  });
});

audio.addEventListener("error", () => {
  const e = audio.error;
  if (e) logLine(`<audio> error code=${e.code} msg=${e.message}`);
});

const modeBtns = [blobBtn, mseBtn, waBtn, workletBtn, bigBufBtn, rodioBtn];
function setSelected(btn: HTMLButtonElement | null) {
  for (const b of modeBtns) b.classList.toggle("selected", b === btn);
  // only show <audio> for modes that actually use it (a/b). c/d/e play via
  // web audio without an <audio> element; f plays natively in rust. hiding
  // the empty/stale element avoids a confusing dead UI.
  const usesAudioEl = btn === blobBtn || btn === mseBtn;
  audio.style.display = usesAudioEl ? "" : "none";
  // rodio controls are only meaningful for f
  rodioControls.style.display = btn === rodioBtn ? "flex" : "none";
  // web-audio status line for c/d/e
  const isWebAudio = btn === waBtn || btn === workletBtn || btn === bigBufBtn;
  waControls.style.display = isWebAudio ? "flex" : "none";
}

function stopAll() {
  // stop <audio>
  try {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  } catch {}
  // revoke blob
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
  // tear down mse
  mediaSource = null;
  // stop web audio
  if (waSource) {
    try { waSource.stop(); } catch {}
    try { waSource.disconnect(); } catch {}
    waSource = null;
  }
  // stop worklet
  if (workletNode) {
    try { workletNode.port.postMessage({ type: "stop" }); } catch {}
    try { workletNode.disconnect(); } catch {}
    workletNode = null;
  }
  // stop big-buffer source (option E)
  if (bigBufSource) {
    try { bigBufSource.stop(); } catch {}
    try { bigBufSource.disconnect(); } catch {}
    bigBufSource = null;
  }
  // stop native rodio (option F)
  stopRodioPolling();
  // stop web-audio status polling (modes c/d/e)
  stopWaPolling();
  waPlayback = null;
  // fire-and-forget; if rodio isn't initialized this just errors silently
  invoke("rodio_stop").catch(() => {});
}

stopBtn.addEventListener("click", () => {
  logLine("stop");
  stopAll();
  setSelected(null);
  stopBtn.disabled = true;
});

pickBtn.addEventListener("click", async () => {
  const selected = await open({
    multiple: true,
    directory: false,
    filters: [{ name: "audio", extensions: ["mp3", "flac", "ogg", "opus", "wav", "m4a", "aac"] }],
  });
  // dialog returns string | string[] | null depending on multiple flag
  let paths: string[];
  if (!selected) {
    logLine("no file selected");
    return;
  } else if (typeof selected === "string") {
    paths = [selected];
  } else if (Array.isArray(selected)) {
    if (selected.length === 0) {
      logLine("no file selected");
      return;
    }
    paths = selected;
  } else {
    logLine("no file selected");
    return;
  }

  pickedPaths = paths;
  // first file is the one A-E will use (they don't have queue concepts)
  const first = paths[0];
  pickedMime = mimeFromExt(first);
  status.textContent =
    paths.length === 1
      ? `${first} (${pickedMime})`
      : `${paths.length} files selected; first: ${first} (${pickedMime})`;
  logLine(`picked ${paths.length} file(s); first: ${first}`);
  setSelected(null);

  // read first file's bytes for A-E (those modes operate on the in-memory
  // buffer). F doesn't need this — it streams from disk on the rust side.
  const t0 = performance.now();
  try {
    const result = await invoke<number[] | ArrayBuffer | Uint8Array>(
      "read_audio_file",
      { path: first },
    );
    pickedBytes =
      result instanceof Uint8Array
        ? result
        : result instanceof ArrayBuffer
          ? new Uint8Array(result)
          : new Uint8Array(result as number[]);
  } catch (e) {
    logLine(`read_audio_file failed: ${e}`);
    return;
  }
  const t1 = performance.now();
  logLine(`read first file: ${pickedBytes!.byteLength} bytes in ${(t1 - t0).toFixed(0)}ms`);
  if (paths.length > 1) {
    logLine(`(modes a-e will only play the first file; f will queue all ${paths.length} gaplessly)`);
  }

  // enable playback buttons
  blobBtn.disabled = false;
  mseBtn.disabled = !MediaSource.isTypeSupported(pickedMime);
  if (mseBtn.disabled) logLine(`mse not supported for ${pickedMime}`);
  waBtn.disabled = false;
  workletBtn.disabled = false;
  bigBufBtn.disabled = false;
  rodioBtn.disabled = false;
});

// --- A: blob: + <audio> (current behavior, the broken one) ---
blobBtn.addEventListener("click", async () => {
  if (!pickedBytes) return;
  stopAll();
  setSelected(blobBtn);
  logLine("== mode A: blob: + <audio> ==");
  const blob = new Blob([pickedBytes], { type: pickedMime });
  currentBlobUrl = URL.createObjectURL(blob);
  logLine(`blob url: ${currentBlobUrl}`);
  audio.src = currentBlobUrl;
  audio.load();
  try { await audio.play(); } catch (e) { logLine(`play() rejected: ${e}`); }
  stopBtn.disabled = false;
});

// --- B: MSE + <audio> ---
mseBtn.addEventListener("click", async () => {
  if (!pickedBytes) return;
  stopAll();
  setSelected(mseBtn);
  logLine("== mode B: MSE + <audio> ==");
  if (!MediaSource.isTypeSupported(pickedMime)) {
    logLine(`MSE: ${pickedMime} not supported`);
    return;
  }
  mediaSource = new MediaSource();
  currentBlobUrl = URL.createObjectURL(mediaSource);
  audio.src = currentBlobUrl;

  // copy bytes into a standalone arraybuffer once
  const fullBytes = pickedBytes;
  const ab = fullBytes.buffer.slice(
    fullBytes.byteOffset,
    fullBytes.byteOffset + fullBytes.byteLength,
  );
  const totalLen = ab.byteLength;

  mediaSource.addEventListener("sourceopen", () => {
    if (!mediaSource) return;
    logLine(`MSE: sourceopen, total=${totalLen} bytes`);
    let sb: SourceBuffer;
    try {
      sb = mediaSource.addSourceBuffer(pickedMime);
    } catch (e) {
      logLine(`MSE: addSourceBuffer failed: ${e}`);
      return;
    }
    sb.mode = "sequence";

    // smaller chunks (1mb) and only refill when buffered ahead < TARGET_AHEAD seconds.
    // this avoids hitting webkit's tiny per-source-buffer quota and stops the spam.
    const CHUNK = 1 * 1024 * 1024;
    const TARGET_AHEAD = 30; // seconds buffered ahead of currentTime
    let offset = 0;
    let appended = 0;
    let pending = false;

    const tryAppend = () => {
      if (!mediaSource || mediaSource.readyState !== "open") return;
      if (sb.updating || pending) return;
      if (offset >= totalLen) {
        logLine(`MSE: all ${appended} chunks appended (${totalLen} bytes)`);
        try {
          mediaSource.endOfStream();
          // once eos is called, set duration from buffered range so the
          // <audio> ui shows a real progress bar instead of "live".
          if (sb.buffered.length > 0) {
            const dur = sb.buffered.end(sb.buffered.length - 1);
            mediaSource.duration = dur;
            logLine(`MSE: duration set to ${dur.toFixed(2)}s`);
          }
        } catch (e) { logLine(`endOfStream: ${e}`); }
        return;
      }
      // wait until we're not too far ahead of playback
      if (sb.buffered.length > 0) {
        const ahead = sb.buffered.end(sb.buffered.length - 1) - audio.currentTime;
        if (ahead > TARGET_AHEAD) {
          // check again shortly
          pending = true;
          setTimeout(() => { pending = false; tryAppend(); }, 250);
          return;
        }
      }
      const end = Math.min(offset + CHUNK, totalLen);
      const slice = ab.slice(offset, end);
      try {
        sb.appendBuffer(slice);
        offset = end;
        appended += 1;
      } catch (e: unknown) {
        const name = (e as { name?: string })?.name;
        if (name === "QuotaExceededError") {
          // evict already-played data, then retry on updateend
          if (sb.buffered.length > 0 && audio.currentTime > 1) {
            try { sb.remove(0, audio.currentTime - 0.5); return; } catch {}
          }
          pending = true;
          setTimeout(() => { pending = false; tryAppend(); }, 250);
          return;
        }
        logLine(`MSE: appendBuffer failed: ${e}`);
      }
    };

    sb.addEventListener("updateend", tryAppend);
    sb.addEventListener("error", (e) => logLine(`MSE: SourceBuffer error: ${e}`));
    audio.addEventListener("timeupdate", tryAppend);

    tryAppend();
  });

  audio.load();
  try { await audio.play(); } catch (e) { logLine(`play() rejected: ${e}`); }
  stopBtn.disabled = false;
});

// --- C: Web Audio (decodeAudioData + AudioBufferSourceNode) ---
waBtn.addEventListener("click", async () => {
  if (!pickedBytes) return;
  stopAll();
  setSelected(waBtn);
  logLine("== mode C: Web Audio ==");

  if (!audioCtx) {
    // latencyHint: "playback" -> webkit picks a larger output buffer
    // (typically ~2048 frames) so the audio thread tolerates more main-thread
    // jank before underrunning. opposite of the default "interactive".
    audioCtx = new AudioContext({ latencyHint: "playback" });
    logLine(
      `AudioContext: sampleRate=${audioCtx.sampleRate} ` +
      `baseLatency=${(audioCtx.baseLatency * 1000).toFixed(1)}ms ` +
      `state=${audioCtx.state}`,
    );
  }
  if (audioCtx.state === "suspended") {
    await audioCtx.resume();
    logLine(`AudioContext resumed: ${audioCtx.state}`);
  }

  // copy bytes into a standalone ArrayBuffer (decodeAudioData consumes it)
  const ab = pickedBytes.buffer.slice(
    pickedBytes.byteOffset,
    pickedBytes.byteOffset + pickedBytes.byteLength,
  );

  const t0 = performance.now();
  try {
    waBuffer = await audioCtx.decodeAudioData(ab);
  } catch (e) {
    logLine(`decodeAudioData failed: ${e}`);
    return;
  }
  const t1 = performance.now();
  logLine(
    `decoded in ${(t1 - t0).toFixed(0)}ms: ${waBuffer.duration.toFixed(2)}s, ` +
    `${waBuffer.numberOfChannels}ch @ ${waBuffer.sampleRate}Hz`,
  );

  waSource = audioCtx.createBufferSource();
  waSource.buffer = waBuffer;
  waSource.connect(audioCtx.destination);
  waSource.addEventListener("ended", () => logLine("WebAudio: ended"));
  waSource.start();
  waPlayback = {
    label: "C",
    ctx: audioCtx,
    startedAtCtxTime: audioCtx.currentTime,
    duration: waBuffer.duration,
  };
  startWaPolling();
  logLine("WebAudio: started");
  stopBtn.disabled = false;
});

// --- D: Worker decode + AudioWorklet ---
// 1. spawn a worker that runs decodeAudioData off the main thread.
// 2. pass the decoded pcm channels (transferred, zero-copy) to an AudioWorkletNode.
// 3. the worklet renders on a dedicated rt-priority audio thread, immune to
//    main-thread jank from compiles / vite hmr / whatever.
workletBtn.addEventListener("click", async () => {
  if (!pickedBytes) return;
  stopAll();
  setSelected(workletBtn);
  logLine("== mode D: worker decode + AudioWorklet ==");

  if (!audioCtx) {
    audioCtx = new AudioContext({ latencyHint: "playback" });
    logLine(
      `AudioContext: sampleRate=${audioCtx.sampleRate} ` +
      `baseLatency=${(audioCtx.baseLatency * 1000).toFixed(1)}ms ` +
      `state=${audioCtx.state}`,
    );
  }
  if (audioCtx.state === "suspended") {
    await audioCtx.resume();
    logLine(`AudioContext resumed: ${audioCtx.state}`);
  }

  if (!workletReady) {
    try {
      logLine("D: loading AudioWorklet module from /audio-playback-worklet.js");
      await audioCtx.audioWorklet.addModule("/audio-playback-worklet.js");
      workletReady = true;
      logLine("D: AudioWorklet module loaded");
    } catch (e) {
      logLine(`D: AudioWorklet addModule failed: ${e}`);
      return;
    }
  }

  // copy bytes for decodeAudioData (it neuters the buffer)
  const ab = pickedBytes.buffer.slice(
    pickedBytes.byteOffset,
    pickedBytes.byteOffset + pickedBytes.byteLength,
  );
  logLine(`D: decoding ${ab.byteLength} bytes on main thread (webkit has no OfflineAudioContext in workers)`);

  const t0 = performance.now();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(ab);
  } catch (e) {
    logLine(`D: decodeAudioData failed: ${e}`);
    return;
  }
  const t1 = performance.now();

  // pull each channel out as its own Float32Array (zero-copy from AudioBuffer)
  const numCh = audioBuffer.numberOfChannels;
  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) {
    // getChannelData returns a view backed by the AudioBuffer; copy so we can
    // transfer the underlying buffer to the worklet without affecting the
    // AudioBuffer itself.
    const src = audioBuffer.getChannelData(c);
    const copy = new Float32Array(src.length);
    copy.set(src);
    channels.push(copy);
  }
  const decoded = {
    channels,
    sampleRate: audioBuffer.sampleRate,
    length: audioBuffer.length,
    numberOfChannels: numCh,
    duration: audioBuffer.duration,
    decodeMs: t1 - t0,
  };

  logLine(
    `D: decoded: ${decoded.decodeMs.toFixed(0)}ms, ` +
    `${decoded.duration.toFixed(2)}s, ${decoded.numberOfChannels}ch @ ${decoded.sampleRate}Hz, ` +
    `length=${decoded.length} samples`,
  );
  // sanity-check the channel data
  const ch0 = decoded.channels[0];
  if (!(ch0 instanceof Float32Array)) {
    logLine(`D: WARNING channels[0] is not Float32Array: ${Object.prototype.toString.call(ch0)}`);
  } else {
    let max = 0;
    const sampleN = Math.min(ch0.length, 44100);
    for (let i = 0; i < sampleN; i++) {
      const v = Math.abs(ch0[i]);
      if (v > max) max = v;
    }
    logLine(`D: channels[0] len=${ch0.length} peak(first 1s)=${max.toFixed(4)}`);
  }

  const outChannels = Math.max(2, decoded.numberOfChannels);
  logLine(`D: creating AudioWorkletNode with ${outChannels} output channel(s)`);
  workletNode = new AudioWorkletNode(audioCtx, "playback-processor", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [outChannels],
  });
  workletNode.onprocessorerror = (e) => logLine(`D: worklet processor error: ${(e as ErrorEvent).message ?? e}`);
  workletNode.port.onmessage = (e: MessageEvent) => {
    logLine(`D: worklet -> main: ${JSON.stringify(e.data)}`);
  };
  workletNode.connect(audioCtx.destination);
  logLine(`D: connected worklet to destination (ctx state=${audioCtx.state})`);

  // hand the pcm to the worklet (transfer the underlying buffers, zero-copy)
  const transfer = decoded.channels.map((c) => c.buffer);
  workletNode.port.postMessage(
    {
      type: "load",
      channels: decoded.channels,
      length: decoded.length,
    },
    transfer,
  );
  workletNode.port.postMessage({ type: "play" });
  waPlayback = {
    label: "D",
    ctx: audioCtx,
    startedAtCtxTime: audioCtx.currentTime,
    duration: decoded.duration,
  };
  startWaPolling();
  logLine("AudioWorklet: started");
  stopBtn.disabled = false;
});

// --- E: Web Audio with explicit numeric latencyHint ---
// same as C but uses latencyHint: 0.5 (literal seconds) instead of "playback".
// some webkit builds honor numeric hints when they ignore string ones, giving
// a noticeably larger output buffer (more headroom before underrun).
// uses its own AudioContext so the hint actually takes effect (existing
// audioCtx may already be created with a different hint).
bigBufBtn.addEventListener("click", async () => {
  if (!pickedBytes) return;
  stopAll();
  setSelected(bigBufBtn);
  logLine("== mode E: Web Audio + big buffer (latencyHint=0.5s) ==");

  if (!bigBufCtx) {
    bigBufCtx = new AudioContext({ latencyHint: 0.5 });
    logLine(
      `E: AudioContext sampleRate=${bigBufCtx.sampleRate} ` +
      `baseLatency=${(bigBufCtx.baseLatency * 1000).toFixed(1)}ms ` +
      `outputLatency=${((bigBufCtx as any).outputLatency != null ? ((bigBufCtx as any).outputLatency * 1000).toFixed(1) + "ms" : "n/a")} ` +
      `state=${bigBufCtx.state}`,
    );
  }
  if (bigBufCtx.state === "suspended") {
    await bigBufCtx.resume();
    logLine(`E: AudioContext resumed: ${bigBufCtx.state}`);
  }

  const ab = pickedBytes.buffer.slice(
    pickedBytes.byteOffset,
    pickedBytes.byteOffset + pickedBytes.byteLength,
  );

  const t0 = performance.now();
  let buf: AudioBuffer;
  try {
    buf = await bigBufCtx.decodeAudioData(ab);
  } catch (e) {
    logLine(`E: decodeAudioData failed: ${e}`);
    return;
  }
  const t1 = performance.now();
  logLine(
    `E: decoded in ${(t1 - t0).toFixed(0)}ms: ${buf.duration.toFixed(2)}s, ` +
    `${buf.numberOfChannels}ch @ ${buf.sampleRate}Hz`,
  );

  bigBufSource = bigBufCtx.createBufferSource();
  bigBufSource.buffer = buf;
  bigBufSource.connect(bigBufCtx.destination);
  bigBufSource.addEventListener("ended", () => logLine("E: ended"));
  bigBufSource.start();
  waPlayback = {
    label: "E",
    ctx: bigBufCtx,
    startedAtCtxTime: bigBufCtx.currentTime,
    duration: buf.duration,
  };
  startWaPolling();
  logLine("E: started");
  stopBtn.disabled = false;
});


// --- F: native rodio playback (cpal + symphonia, no webview involvement) ---
//
// rust holds the OutputStream + Sink. we just send paths and control msgs
// over ipc. multi-file picks queue gaplessly via rodio's sink.append.
// position is polled every 500ms while playing.

interface RodioStatusResp {
  has_sink: boolean;
  is_paused: boolean;
  queue_len: number;
  position_secs: number;
  total_secs: number;
  volume: number;
}

let rodioPollTimer: number | null = null;

function stopRodioPolling() {
  if (rodioPollTimer != null) {
    clearInterval(rodioPollTimer);
    rodioPollTimer = null;
  }
}

function startRodioPolling() {
  stopRodioPolling();
  rodioPollTimer = window.setInterval(async () => {
    try {
      const s = await invoke<RodioStatusResp>("rodio_status");
      const state = !s.has_sink
        ? "stopped"
        : s.is_paused
          ? "paused"
          : "playing";
      rodioStatus.textContent =
        `${state} | track ${s.position_secs.toFixed(1)}s | queue: ${s.queue_len} ` +
        `| total queued: ${s.total_secs.toFixed(1)}s | vol: ${s.volume.toFixed(2)}`;
      // if the queue is fully drained, stop polling
      if (!s.has_sink || s.queue_len === 0) {
        // still let one more poll happen so user sees "stopped"
      }
    } catch (e) {
      logLine(`rodio_status failed: ${e}`);
      stopRodioPolling();
    }
  }, 500);
}

rodioBtn.addEventListener("click", async () => {
  if (pickedPaths.length === 0) return;
  stopAll();
  setSelected(rodioBtn);
  logLine(`== mode F: native rodio (${pickedPaths.length} file${pickedPaths.length === 1 ? "" : "s"}) ==`);
  try {
    const t0 = performance.now();
    const totalSecs = await invoke<number>("rodio_play", { paths: pickedPaths });
    const t1 = performance.now();
    logLine(`F: rodio_play started in ${(t1 - t0).toFixed(0)}ms; total queued duration: ${totalSecs.toFixed(2)}s`);
    startRodioPolling();
    stopBtn.disabled = false;
  } catch (e) {
    logLine(`F: rodio_play failed: ${e}`);
  }
});

rodioPauseBtn.addEventListener("click", async () => {
  try { await invoke("rodio_pause"); logLine("F: pause"); }
  catch (e) { logLine(`F: pause failed: ${e}`); }
});

rodioResumeBtn.addEventListener("click", async () => {
  try { await invoke("rodio_resume"); logLine("F: resume"); }
  catch (e) { logLine(`F: resume failed: ${e}`); }
});

rodioSeekBtn.addEventListener("click", async () => {
  const seconds = parseFloat(rodioSeekInput.value);
  if (!isFinite(seconds) || seconds < 0) {
    logLine(`F: invalid seek value: ${rodioSeekInput.value}`);
    return;
  }
  try {
    await invoke("rodio_seek", { seconds });
    logLine(`F: seek to ${seconds}s`);
  } catch (e) {
    logLine(`F: seek failed: ${e} (some formats don't support seek)`);
  }
});

rodioVolInput.addEventListener("input", async () => {
  const volume = parseFloat(rodioVolInput.value);
  try { await invoke("rodio_set_volume", { volume }); }
  catch (e) { logLine(`F: set_volume failed: ${e}`); }
});
