// dev-only test bridge: exposes window.__playerTest so playwright specs can
// drive real pairing handshakes against this page's actual player node,
// without needing a second full app instance. gated by import.meta.env.DEV
// so none of this ships in a production build.
//
// mirrors the window.__<app>Test bridge pattern used in skein/loam and
// playlistz's e2e suites.

import { MiddenNode, type BiStream } from "@freqhole/midden";
import { getPlayerNode, PLAYER_ALPN } from "../midden/node";
import { currentPin } from "../pairing/pinStore";

declare global {
  interface Window {
    __playerTest?: {
      getPlayerNodeId(): Promise<string>;
      getPin(): string;
      dialAndPair(
        peerNodeId: string,
        pin: string,
        displayName: string,
      ): Promise<{ ok: boolean; reason?: string } | null>;
      dialCommand(peerNodeId: string, commandLine: string): Promise<unknown>;
      importTestAudioBlob(durationMs?: number): Promise<{ peerNodeId: string; hash: string }>;
      openSession(peerNodeId: string): Promise<string>;
      sendOnSession(sessionId: string, commandLine: string): Promise<unknown>;
      closeSession(sessionId: string): void;
    };
  }
}

let testPeer: MiddenNode | null = null;
const sessions = new Map<string, BiStream>();

async function ensureTestPeer(): Promise<MiddenNode> {
  if (!testPeer) {
    testPeer = await MiddenNode.create();
  }
  return testPeer;
}

/** builds a tiny valid (silent) WAV file - enough for <audio> to actually play it. */
function buildSilentWav(sampleCount = 4_000): Uint8Array {
  const dataSize = sampleCount * 2; // 16-bit mono
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 44_100, true);
  view.setUint32(28, 44_100 * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  // data bytes are already zeroed (silence) - nothing more to write.
  return new Uint8Array(buffer);
}

async function importTestAudioBlob(durationMs = 90): Promise<{ peerNodeId: string; hash: string }> {
  const peer = await ensureTestPeer();
  const hash = await peer.import_blob(buildSilentWav(Math.round((durationMs / 1000) * 44_100)));
  peer.start_blob_server();
  return { peerNodeId: peer.node_id(), hash };
}

async function dialAndPair(
  peerNodeId: string,
  pin: string,
  displayName: string,
): Promise<{ ok: boolean; reason?: string } | null> {
  const peer = await ensureTestPeer();
  const stream = await peer.open_bi(peerNodeId, PLAYER_ALPN);
  await stream.write_line(JSON.stringify({ type: "pair_request", pin, display_name: displayName }));
  const line = (await stream.read_line()) as string | null;
  stream.close();
  return line ? JSON.parse(line) : null;
}

async function dialCommand(peerNodeId: string, commandLine: string): Promise<unknown> {
  const peer = await ensureTestPeer();
  const stream = await peer.open_bi(peerNodeId, PLAYER_ALPN);
  await stream.write_line(commandLine);
  const line = (await stream.read_line()) as string | null;
  stream.close();
  return line ? JSON.parse(line) : null;
}

// unlike dialCommand (opens/closes a stream per call), these keep a control
// stream open across multiple commands - needed to exercise anything that
// depends on a live connection (e.g. the connected-controllers indicator).
async function openSession(peerNodeId: string): Promise<string> {
  const peer = await ensureTestPeer();
  const stream = (await peer.open_bi(peerNodeId, PLAYER_ALPN)) as BiStream;
  const id = crypto.randomUUID();
  sessions.set(id, stream);
  return id;
}

async function sendOnSession(sessionId: string, commandLine: string): Promise<unknown> {
  const stream = sessions.get(sessionId);
  if (!stream) throw new Error("unknown test session");
  await stream.write_line(commandLine);
  const line = (await stream.read_line()) as string | null;
  return line ? JSON.parse(line) : null;
}

function closeSession(sessionId: string): void {
  sessions.get(sessionId)?.close();
  sessions.delete(sessionId);
}

export function registerTestBridge(): void {
  if (!import.meta.env.DEV) return;

  window.__playerTest = {
    getPlayerNodeId: async () => (await getPlayerNode()).node_id(),
    getPin: () => currentPin(),
    dialAndPair,
    dialCommand,
    importTestAudioBlob,
    openSession,
    sendOnSession,
    closeSession,
  };
}
