// answers "freqhole/1" api-request probes - the same probe spume's
// regular "add remote" flow sends to every peer it's asked to add
// (client.app.serverInfo() -> GET /api/hello). player devices are
// deliberately NOT full remotes (see docs/player-remote-site-plan.md
// phase 5), so this only ever answers that one path, and marks the
// response with player_device: true so spume's add-remote flow can
// recognize it and point the user at "pair a player" instead of
// treating it as a dead-end remote-server candidate.

import type { BiStream } from "@freqhole/midden";
import { deviceName } from "../settings/deviceNameStore";

interface ApiRequestMessage {
  type: "api_request";
  id: number;
  method: string;
  path: string;
  body: string | null;
}

function isApiRequestMessage(value: unknown): value is ApiRequestMessage {
  return (
    !!value && typeof value === "object" && (value as { type?: unknown }).type === "api_request"
  );
}

async function writeApiResponse(
  stream: BiStream,
  id: number,
  status: number,
  body: unknown,
): Promise<void> {
  const message = { type: "api_response", id, status, body: JSON.stringify(body) };
  await stream.write_raw_and_finish(new TextEncoder().encode(JSON.stringify(message)));
}

/** handle a single request/response round-trip on the `freqhole/1` ALPN. */
export async function handleApiRequest(stream: BiStream): Promise<void> {
  try {
    const bytes = (await stream.read_to_end(64 * 1024)) as Uint8Array | null;
    if (bytes === null) return;

    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isApiRequestMessage(parsed)) return;

    if (parsed.method === "GET" && parsed.path === "/api/hello") {
      await writeApiResponse(stream, parsed.id, 200, {
        name: deviceName(),
        description: "freqhole player device",
        version: "0.0.1",
        image_url: null,
        image_blob_id: null,
        knocking_enabled: false,
        player_device: true,
      });
      return;
    }

    await writeApiResponse(stream, parsed.id, 404, { error: "not found" });
  } catch (err) {
    console.error("[player] api request handling failed:", err);
  } finally {
    stream.close();
  }
}
