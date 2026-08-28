// control command dispatcher (phase 3/4): validates commands from an
// already-trusted controller and routes them to the playback engine.

import type { MiddenNode } from "@freqhole/midden";
import { PlayerCommandSchema, type CommandAck } from "./schema";
import * as playbackEngine from "../playback/playbackEngine";
import * as radioClient from "../playback/radioClient";

export async function dispatchCommand(node: MiddenNode, rawLine: string): Promise<CommandAck> {
  const parsed = PlayerCommandSchema.safeParse(JSON.parse(rawLine));
  if (!parsed.success) {
    return { type: "command_ack", ok: false, reason: "invalid_command" };
  }

  const command = parsed.data;
  switch (command.command) {
    case "play":
      await playbackEngine.play(node, command.item);
      break;
    case "replace_queue":
      await playbackEngine.replaceQueue(node, command.items);
      break;
    case "append_queue":
      playbackEngine.appendQueue(node, command.items);
      break;
    case "pause":
      playbackEngine.pause();
      break;
    case "resume":
      playbackEngine.resume();
      break;
    case "seek":
      playbackEngine.seek(command.position_ms);
      break;
    case "skip":
      await playbackEngine.skip(node);
      break;
    case "set_volume":
      playbackEngine.setVolume(command.volume);
      break;
    case "stop":
      playbackEngine.stop();
      break;
    case "tune_radio":
      await radioClient.startRadio(node, command.peer_addr, command.station_id);
      break;
    case "stop_radio":
      radioClient.stopRadio();
      break;
    case "get_status":
      break;
  }

  return { type: "command_ack", ok: true, status: playbackEngine.currentStatus() };
}
