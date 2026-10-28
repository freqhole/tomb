// player-side radio access handling: when a controller asks this player to
// tune into a station, the PLAYER's own node is what dials the
// broadcaster - so a private station only works if the broadcasting
// remote knows this player. the radio protocol itself gives no structured
// "denied" signal (the broadcaster just closes the stream before Hello),
// so after a failed tune this probes the broadcaster's authenticated
// `whoami` route to tell "not allowed here" apart from "couldn't reach it"
// or "something else went wrong", and reports that as a specific ack
// reason (see `PlaybackCommandError`) the controller can act on.
//
// also sends the player's own access request (knock) on the controller's
// behalf - the knock has to come from this node, since that's the
// identity the broadcaster's admin will be approving.

import { PlaybackCommandError } from "../control/playbackBackend";
import {
  getClientForRemote,
  isAuthError,
  isCharnelAvailable,
  isNetworkError,
} from "../../app/api/client";
import { RadioTuneSupersededError, tuneIntoRadio } from "../../app/services/radio/radioService";
import { formatErrorMessage } from "../../app/services/remotes/formatErrorMessage";
import { warn } from "../../utils/logger";

export type SourceAccessProbe = "authorized" | "unauthorized" | "unreachable";

async function clientFor(peerAddr: string) {
  return getClientForRemote({
    transport: isCharnelAvailable() ? "app" : "wasm",
    peer_addr: peerAddr,
  });
}

/** asks the remote at `peerAddr` who this node is - an authenticated
 * route, so an unknown peer gets a 401 (`unauthorized: peer not
 * registered`) rather than a transport failure. */
export async function probeSourceAccess(peerAddr: string): Promise<SourceAccessProbe> {
  try {
    const client = await clientFor(peerAddr);
    const result = await client.auth.whoami();
    if (result.success) return "authorized";
    if (isAuthError(result)) return "unauthorized";
    if (isNetworkError(result)) return "unreachable";
    // some other error from a peer that did answer - we got through, so
    // access isn't what's in the way.
    return "authorized";
  } catch {
    return "unreachable";
  }
}

export interface RadioSourceAccessDeps {
  tune: (peerAddr: string, stationId?: string) => Promise<void>;
  probe: (peerAddr: string) => Promise<SourceAccessProbe>;
  sendKnock: (peerAddr: string, username: string, message: string) => Promise<void>;
}

const defaultDeps: RadioSourceAccessDeps = {
  tune: async (peerAddr, stationId) => {
    await tuneIntoRadio(peerAddr, { stationId });
  },
  probe: probeSourceAccess,
  sendKnock: async (peerAddr, username, message) => {
    const client = await clientFor(peerAddr);
    const result = await client.admin.createKnockPublic({ username, message });
    if (!result.success) {
      throw new Error(
        "error" in result ? formatErrorMessage(result.error) : "failed to send access request"
      );
    }
  },
};

/** tunes into `peerAddr`'s station, classifying a failure into a
 * `PlaybackCommandError` (source_access_denied / source_unreachable /
 * tune_failed). a tune superseded by a newer one isn't a failure and
 * resolves quietly. */
export async function tuneRadioWithAccessCheck(
  peerAddr: string,
  stationId: string | undefined,
  deps: RadioSourceAccessDeps = defaultDeps
): Promise<void> {
  try {
    await deps.tune(peerAddr, stationId);
  } catch (err) {
    if (err instanceof RadioTuneSupersededError) return;
    const detail = err instanceof Error ? err.message : String(err);
    const probe = await deps.probe(peerAddr);
    warn("radioSourceAccess", `tune failed (${detail}), source probe: ${probe}`);
    if (probe === "unauthorized") throw new PlaybackCommandError("source_access_denied", detail);
    if (probe === "unreachable") throw new PlaybackCommandError("source_unreachable", detail);
    throw new PlaybackCommandError("tune_failed", detail);
  }
}

/** sends this player's own knock to `peerAddr`, surfacing the remote's
 * refusal (e.g. knocking disabled, username taken) as
 * `request_access_failed` with its message as `detail`. */
export async function requestSourceAccess(
  peerAddr: string,
  username: string,
  message: string | undefined,
  deps: RadioSourceAccessDeps = defaultDeps
): Promise<void> {
  try {
    await deps.sendKnock(peerAddr, username, message ?? "");
  } catch (err) {
    throw new PlaybackCommandError(
      "request_access_failed",
      err instanceof Error ? err.message : String(err)
    );
  }
}
