// the bundled effect runner for the add-peer flow: executes the effect
// descriptors the machine emits against an injected `AddPeerFlowDeps`,
// and feeds each async outcome back into the machine as an event.
//
// `createAddPeerFlow` ties machine + runner together: `send(event)` is
// the pure transition (returns the effects it produced), `runEffect`
// executes one effect and recursively drains any follow-on effects its
// result event produces. an adapter that wants full control (its own
// scheduler, effect logging, replay) can ignore `runEffect` and execute
// the descriptors itself.
//
// cancellation: CHECK_CONNECTION / CHECK_KNOCK_STATUS runs are tracked
// with a generation counter; CANCEL_IN_FLIGHT (emitted by BACK from
// `testing` and by MODAL_CLOSE) bumps it, and a superseded run's outcome
// event is discarded instead of being fed to the machine.

import { parsePeerAddress } from "../../share/peer-addr.js";
import {
  initialContext,
  projectState,
  transition,
  type AddPeerContext,
} from "./machine.js";
import type {
  AddPeerEffect,
  AddPeerEvent,
  AddPeerFlowDeps,
  AddPeerState,
  ConnectionOutcome,
  KnockStatusOutcome,
  PendingRemote,
  PeerTarget,
} from "./types.js";

export interface AddPeerFlow {
  state(): AddPeerState;
  /** pure transition: applies `event`, returns the effects it produced.
   *  the caller (or `runEffect`) is responsible for executing them in
   *  order. */
  send(event: AddPeerEvent): AddPeerEffect[];
  /** execute one effect against the deps, feed its outcome event back
   *  into the machine, and drain any follow-on effects. */
  runEffect(effect: AddPeerEffect): Promise<void>;
  /** send + drain in one call: the usual adapter entry point. */
  dispatch(event: AddPeerEvent): Promise<void>;
  dispose(): void;
}

function describeConnectError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout/i.test(msg)) {
    return "connection timed out - peer may be offline or unreachable";
  }
  if (/not ?found/i.test(msg)) {
    return "peer not found - check the address and try again";
  }
  return `connection failed: ${msg}`;
}

function isAuthRejection(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("Unauthorized") ||
    msg.includes("Forbidden")
  );
}

export function createAddPeerFlow(deps: AddPeerFlowDeps): AddPeerFlow {
  let ctx: AddPeerContext = initialContext();
  let disposed = false;
  /** generation counter for cancellable probes; CANCEL_IN_FLIGHT bumps it. */
  let probeGeneration = 0;
  const timerCancels = new Map<string, () => void>();

  function send(event: AddPeerEvent): AddPeerEffect[] {
    if (disposed) return [];
    const result = transition(ctx, event);
    ctx = result.ctx;
    return result.effects;
  }

  async function feed(event: AddPeerEvent): Promise<void> {
    for (const effect of send(event)) {
      await runEffect(effect);
    }
  }

  function scheduleTimer(id: string, ms: number): void {
    timerCancels.get(id)?.();
    const fire = (): void => {
      timerCancels.delete(id);
      void feed({ type: "TIMER_FIRED", id });
    };
    if (deps.scheduleTimer) {
      timerCancels.set(id, deps.scheduleTimer(id, ms, fire));
    } else {
      const handle = setTimeout(fire, ms);
      timerCancels.set(id, () => clearTimeout(handle));
    }
  }

  async function probeConnection(target: PeerTarget): Promise<ConnectionOutcome> {
    let info;
    try {
      info = await deps.getServerInfo(target);
    } catch (err) {
      // an auth rejection on the probe itself can still mean "knockable":
      // the hello surface is public, so re-read it to route to the knock
      // form instead of a dead-end error.
      if (isAuthRejection(err)) {
        try {
          const helloInfo = await deps.getServerInfo(target);
          if (helloInfo?.knocking_enabled) {
            return {
              kind: "needs_knock",
              serverInfo: helloInfo,
              error: "access denied - you can request access from the server admin",
            };
          }
        } catch {
          // fall through to the generic failure below
        }
      }
      return { kind: "failed", error: describeConnectError(err) };
    }
    if (!info) {
      return {
        kind: "failed",
        error: "connection succeeded but the peer did not return valid server info",
      };
    }

    let authed = false;
    try {
      authed = await deps.whoami(target);
    } catch {
      authed = false;
    }
    if (authed) return { kind: "already_authed", serverInfo: info };
    if (info.knocking_enabled) return { kind: "needs_knock", serverInfo: info };
    return { kind: "needs_auth", serverInfo: info };
  }

  async function probeKnockStatus(pending: PendingRemote): Promise<KnockStatusOutcome> {
    const target: PeerTarget = parsePeerAddress(pending.peer_addr) ?? {
      type: "p2p",
      peerAddr: pending.peer_addr,
    };
    try {
      const status = await deps.checkKnockStatus(pending.peer_addr);
      if (status === "rejected") return { kind: "denied" };
      if (status === "pending") return { kind: "pending" };
      if (status === "accepted") {
        const info = await deps.getServerInfo(target).catch(() => null);
        let authed = false;
        try {
          authed = await deps.whoami(target);
        } catch {
          authed = false;
        }
        return authed
          ? { kind: "accepted_authed", serverInfo: info }
          : { kind: "accepted_needs_auth", serverInfo: info };
      }
      // no status available: a successful plain connection means the
      // knock must have been accepted
      const info = await deps.getServerInfo(target).catch(() => null);
      if (info) {
        let authed = false;
        try {
          authed = await deps.whoami(target);
        } catch {
          authed = false;
        }
        return authed
          ? { kind: "accepted_authed", serverInfo: info }
          : { kind: "accepted_needs_auth", serverInfo: info };
      }
      return { kind: "unreachable" };
    } catch {
      return { kind: "unreachable" };
    }
  }

  async function upsertPending(
    peerAddr: string,
    patch: Partial<Omit<PendingRemote, "id" | "peer_addr">>
  ): Promise<void> {
    const existing = await deps.getPendingRemoteByPeerAddr(peerAddr);
    if (existing) {
      await deps.updatePendingRemote(existing.id, patch);
    } else {
      const target = parsePeerAddress(peerAddr) ?? { type: "p2p" as const, peerAddr };
      await deps.createPendingRemote({
        peer_addr: peerAddr,
        transport: deps.transportFor(target),
        stage: "testing",
        server_name: null,
        server_description: null,
        server_version: null,
        server_image_data: null,
        server_image_type: null,
        knock_username: null,
        knock_message: null,
        error_message: null,
        ...patch,
      });
    }
    const records = await deps.getAllPendingRemotes();
    await feed({ type: "PENDING_LOADED", records });
  }

  async function runEffect(effect: AddPeerEffect): Promise<void> {
    if (disposed) return;
    switch (effect.type) {
      case "LOAD_PENDING_REMOTES": {
        const records = await deps.getAllPendingRemotes().catch(() => []);
        await feed({ type: "PENDING_LOADED", records });
        return;
      }

      case "CHECK_DUPLICATE": {
        const remotes = await deps.getAllRemotes().catch(() => []);
        const target = effect.target;
        const duplicate =
          target.type === "http"
            ? remotes.find((r) => r.base_url === target.url)
            : remotes.find((r) => r.peer_addr === target.peerAddr);
        await feed({ type: "DUPLICATE_RESULT", duplicateName: duplicate?.name ?? null });
        return;
      }

      case "UPSERT_PENDING":
        await upsertPending(effect.peerAddr, effect.patch).catch(() => {});
        return;

      case "DELETE_PENDING":
        await deps.deletePendingRemote(effect.id).catch(() => {});
        return;

      case "DELETE_PENDING_BY_ADDR": {
        await deps.deletePendingRemoteByPeerAddr(effect.peerAddr).catch(() => {});
        const records = await deps.getAllPendingRemotes().catch(() => []);
        await feed({ type: "PENDING_LOADED", records });
        return;
      }

      case "CHECK_CONNECTION": {
        const generation = ++probeGeneration;
        const outcome = await probeConnection(effect.target);
        if (disposed || generation !== probeGeneration) return; // cancelled/superseded
        await feed({ type: "CONNECTION_RESULT", outcome });
        return;
      }

      case "CHECK_KNOCK_STATUS": {
        const generation = ++probeGeneration;
        const outcome = await probeKnockStatus(effect.pending);
        if (disposed || generation !== probeGeneration) return;
        await feed({ type: "KNOCK_STATUS_RESULT", outcome });
        return;
      }

      case "SEND_KNOCK": {
        try {
          await deps.sendKnock(effect.peerAddr, effect.username, effect.message);
          await feed({ type: "KNOCK_SENT_RESULT", ok: true });
        } catch (err) {
          await feed({
            type: "KNOCK_SENT_RESULT",
            ok: false,
            error: err instanceof Error ? err.message : "failed to send access request",
          });
        }
        return;
      }

      case "AUTH_HTTP": {
        try {
          await deps.authenticateHttp(effect.url, {
            mode: effect.mode,
            username: effect.username,
            inviteCode: effect.inviteCode,
          });
          await feed({ type: "AUTH_RESULT", ok: true });
        } catch (err) {
          await feed({
            type: "AUTH_RESULT",
            ok: false,
            error: err instanceof Error ? err.message : "authentication failed",
          });
        }
        return;
      }

      case "AUTH_REDEEM_INVITE": {
        try {
          await deps.redeemInvite(effect.peerAddr, effect.username, effect.inviteCode);
          await feed({ type: "AUTH_RESULT", ok: true });
        } catch (err) {
          await feed({
            type: "AUTH_RESULT",
            ok: false,
            error: err instanceof Error ? err.message : "invite code redemption failed",
          });
        }
        return;
      }

      case "AUTH_PASSKEY_REGISTER": {
        try {
          await deps.registerWithPasskey(effect.peerAddr, effect.username, effect.inviteCode);
          await feed({ type: "AUTH_RESULT", ok: true });
        } catch (err) {
          await feed({
            type: "AUTH_RESULT",
            ok: false,
            error: err instanceof Error ? err.message : "passkey registration failed",
          });
        }
        return;
      }

      case "AUTH_PASSKEY_LOGIN": {
        try {
          await deps.loginWithPasskey(effect.target, effect.username);
          await feed({ type: "AUTH_RESULT", ok: true });
        } catch (err) {
          await feed({
            type: "AUTH_RESULT",
            ok: false,
            error: err instanceof Error ? err.message : "passkey login failed",
          });
        }
        return;
      }

      case "CREATE_REMOTE": {
        try {
          const remote = await deps.createRemote({
            base_url: effect.url || undefined,
            peer_addr: effect.peerAddr || undefined,
          });
          await feed({ type: "REMOTE_CREATED", ok: true, remote });
        } catch (err) {
          await feed({
            type: "REMOTE_CREATED",
            ok: false,
            error: err instanceof Error ? err.message : "failed to save remote",
          });
        }
        return;
      }

      case "CANCEL_IN_FLIGHT":
        probeGeneration++;
        return;

      case "SCHEDULE_TIMER":
        scheduleTimer(effect.id, effect.ms);
        return;

      case "CLEAR_QUERY_PARAM":
        deps.clearQueryParam?.();
        return;

      case "CALL_ON_SUCCESS":
        deps.onSuccess?.(effect.remote);
        return;

      case "CALL_ON_CLOSE":
        deps.onClose?.();
        return;
    }
  }

  return {
    state: () => projectState(ctx),
    send,
    runEffect,
    dispatch: feed,
    dispose(): void {
      disposed = true;
      probeGeneration++;
      for (const cancel of timerCancels.values()) cancel();
      timerCancels.clear();
    },
  };
}
