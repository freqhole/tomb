// the add-peer flow machine: a pure, synchronous state machine driving
// "add a remote peer" ui (address entry -> connection test -> knock
// request or auth -> saved remote).
//
// `send(event)` computes the next state and returns effect descriptors;
// it performs no io. an adapter executes the effects and feeds their
// outcomes back in as events - the bundled `runEffect` (runner.ts) does
// exactly that against an injected `AddPeerFlowDeps`. timers, abort
// controllers, and object urls live in the adapter, never here.
//
// load-bearing rules encoded in the table:
// - a pending record is persisted (stage "testing") BEFORE the probe
//   runs, so an abandoned attempt is resumable from the pending list.
// - every probe failure path persists stage "failed" with a specific
//   error string and returns to url/input.
// - an accepted knock deletes its pending record, then whoami decides
//   complete-vs-auth; a denied knock persists stage "knock_rejected".
// - COMPLETE_PEER_ADDR (a knock-accepted / device-linked push) completes
//   the flow from ANY state when the address matches the staged peer or
//   a known pending record.
// - `complete` auto-dismisses via a SCHEDULE_TIMER effect (1500ms), never
//   an inline setTimeout.

import { parsePeerAddress } from "../../share/peer-addr.js";
import type {
  AddPeerEffect,
  AddPeerEvent,
  AddPeerState,
  PendingRemote,
  PeerServerInfo,
  PeerTarget,
  SavedRemote,
} from "./types.js";

export const COMPLETE_DISMISS_MS = 1500;
export const DISMISS_TIMER_ID = "dismiss";

/** internal machine context. the public `AddPeerState` union is projected
 *  from this via `projectState`. */
export interface AddPeerContext {
  step: "url" | "testing" | "auth" | "knock_sent" | "complete";
  subStep: "input" | "knock_form";
  input: string;
  /** normalized http base url ("" when the target is p2p). */
  url: string;
  /** staged p2p peer address (null when the target is http). */
  peerAddr: string | null;
  /** classified target of the in-flight attempt. */
  target: PeerTarget | null;
  error: string | null;
  progress: string | null;
  serverInfo: PeerServerInfo | null;
  pendingRemotes: PendingRemote[];
  /** knock form values staged between SEND_KNOCK and its result. */
  knockDraft: { username: string; message: string } | null;
  /** the pending record a knock-status re-check is running for. */
  retryPending: PendingRemote | null;
  remote: SavedRemote | null;
}

export function initialContext(): AddPeerContext {
  return {
    step: "url",
    subStep: "input",
    input: "",
    url: "",
    peerAddr: null,
    target: null,
    error: null,
    progress: null,
    serverInfo: null,
    pendingRemotes: [],
    knockDraft: null,
    retryPending: null,
    remote: null,
  };
}

export function projectState(ctx: AddPeerContext): AddPeerState {
  switch (ctx.step) {
    case "url":
      return {
        step: "url",
        subStep: ctx.subStep,
        error: ctx.error,
        pendingRemotes: ctx.pendingRemotes,
        serverInfo: ctx.serverInfo,
        peerAddr: ctx.peerAddr,
      };
    case "testing":
      return { step: "testing", progress: ctx.progress, peerAddr: ctx.peerAddr, url: ctx.url };
    case "auth":
      return {
        step: "auth",
        error: ctx.error,
        serverInfo: ctx.serverInfo,
        peerAddr: ctx.peerAddr,
        url: ctx.url,
      };
    case "knock_sent":
      return { step: "knock_sent" };
    case "complete":
      // remote is always set by the REMOTE_CREATED transition that enters this step
      return { step: "complete", remote: ctx.remote! };
  }
}

export interface TransitionResult {
  ctx: AddPeerContext;
  effects: AddPeerEffect[];
}

function noop(ctx: AddPeerContext): TransitionResult {
  return { ctx, effects: [] };
}

/** the key a pending record / saved remote is addressed by for the
 *  current attempt: the p2p peer addr, or the http url. */
function addrKey(ctx: AddPeerContext): string {
  return ctx.peerAddr ?? ctx.url;
}

function toUrlInput(ctx: AddPeerContext, error: string | null): AddPeerContext {
  return { ...ctx, step: "url", subStep: "input", error, progress: null };
}

/** patch fields recording a probe's server info onto a pending record. */
function serverInfoPatch(info: PeerServerInfo | null): Partial<Omit<PendingRemote, "id" | "peer_addr">> {
  if (!info) return {};
  return {
    server_name: info.name,
    server_description: info.description ?? null,
    server_version: info.version,
  };
}

export function transition(ctx: AddPeerContext, event: AddPeerEvent): TransitionResult {
  switch (event.type) {
    case "MODAL_OPEN": {
      const fresh = initialContext();
      fresh.input = event.initialInput ?? "";
      return { ctx: fresh, effects: [{ type: "LOAD_PENDING_REMOTES" }] };
    }

    case "MODAL_CLOSE":
      return {
        ctx: initialContext(),
        effects: [{ type: "CANCEL_IN_FLIGHT" }, { type: "CALL_ON_CLOSE" }],
      };

    case "INPUT_CHANGE":
    case "QR_SCAN":
      return noop({ ...ctx, input: event.input, error: null });

    case "PENDING_LOADED":
      return noop({ ...ctx, pendingRemotes: event.records });

    case "SUBMIT_URL": {
      if (ctx.step !== "url") return noop(ctx);
      const target = parsePeerAddress(event.input);
      if (!target) {
        return noop({ ...ctx, error: "please enter a server url or peer id" });
      }
      if (target.type === "http") {
        try {
          new URL(target.url);
        } catch {
          return noop({
            ...ctx,
            error: "please enter a valid url (e.g. https://music.example.com)",
          });
        }
      }
      const next: AddPeerContext = {
        ...ctx,
        step: "testing",
        input: event.input,
        target,
        peerAddr: target.type === "p2p" ? target.peerAddr : null,
        url: target.type === "http" ? target.url : "",
        error: null,
        progress: null,
        serverInfo: null,
        retryPending: null,
      };
      return { ctx: next, effects: [{ type: "CHECK_DUPLICATE", target }] };
    }

    case "DUPLICATE_RESULT": {
      if (ctx.step !== "testing") return noop(ctx);
      if (event.duplicateName) {
        return noop(
          toUrlInput(
            ctx,
            `this server is already added as "${event.duplicateName}". each server can only be added once.`
          )
        );
      }
      // persist the attempt BEFORE probing, so a closed tab can resume it
      return {
        ctx,
        effects: [
          {
            type: "UPSERT_PENDING",
            peerAddr: addrKey(ctx),
            patch: { stage: "testing", error_message: null },
          },
          { type: "CLEAR_QUERY_PARAM" },
          { type: "CHECK_CONNECTION", target: ctx.target! },
        ],
      };
    }

    case "CONNECTION_RESULT": {
      if (ctx.step !== "testing") return noop(ctx);
      const { outcome } = event;
      switch (outcome.kind) {
        case "already_authed":
          return {
            ctx: { ...ctx, serverInfo: outcome.serverInfo, progress: "creating remote..." },
            effects: [{ type: "CREATE_REMOTE", peerAddr: ctx.peerAddr, url: ctx.url }],
          };
        case "needs_knock":
          return {
            ctx: {
              ...ctx,
              step: "url",
              subStep: "knock_form",
              serverInfo: outcome.serverInfo,
              error: outcome.error ?? null,
              progress: null,
            },
            effects: [
              {
                type: "UPSERT_PENDING",
                peerAddr: addrKey(ctx),
                patch: { stage: "connected", ...serverInfoPatch(outcome.serverInfo) },
              },
            ],
          };
        case "needs_auth":
          return {
            ctx: {
              ...ctx,
              step: "auth",
              serverInfo: outcome.serverInfo,
              error: null,
              progress: null,
            },
            effects: [
              {
                type: "UPSERT_PENDING",
                peerAddr: addrKey(ctx),
                patch: { stage: "connected", ...serverInfoPatch(outcome.serverInfo) },
              },
            ],
          };
        case "failed":
          return {
            ctx: toUrlInput(ctx, outcome.error),
            effects: [
              {
                type: "UPSERT_PENDING",
                peerAddr: addrKey(ctx),
                patch: { stage: "failed", error_message: outcome.error },
              },
            ],
          };
      }
      break;
    }

    case "SUBMIT_KNOCK": {
      if (ctx.step !== "url" || ctx.subStep !== "knock_form") return noop(ctx);
      if (!ctx.peerAddr) {
        return noop({ ...ctx, error: "no peer address available" });
      }
      return {
        ctx: { ...ctx, knockDraft: { username: event.username, message: event.message }, error: null },
        effects: [
          {
            type: "SEND_KNOCK",
            peerAddr: ctx.peerAddr,
            username: event.username,
            message: event.message,
          },
        ],
      };
    }

    case "KNOCK_SENT_RESULT": {
      if (ctx.step !== "url" || ctx.subStep !== "knock_form") return noop(ctx);
      if (!event.ok) {
        return noop({ ...ctx, error: event.error ?? "failed to send access request" });
      }
      const draft = ctx.knockDraft;
      return {
        ctx: { ...ctx, step: "knock_sent", knockDraft: null },
        effects: [
          {
            type: "UPSERT_PENDING",
            peerAddr: addrKey(ctx),
            patch: {
              stage: "knock_pending",
              knock_username: draft?.username ?? null,
              knock_message: draft?.message ?? null,
              ...serverInfoPatch(ctx.serverInfo),
            },
          },
        ],
      };
    }

    case "CANCEL_KNOCK":
      if (ctx.step !== "url" || ctx.subStep !== "knock_form") return noop(ctx);
      return noop(toUrlInput(ctx, null));

    case "USE_INVITE_CODE":
    case "PASSKEY_SIGNIN":
      if (ctx.step !== "url" || ctx.subStep !== "knock_form") return noop(ctx);
      return noop({ ...ctx, step: "auth", error: null });

    case "SUBMIT_AUTH": {
      if (ctx.step !== "auth") return noop(ctx);
      if (ctx.peerAddr) {
        if (event.mode === "login") {
          return noop({
            ...ctx,
            error: "login not yet supported for p2p remotes - please register with an invite code",
          });
        }
        if (!event.inviteCode) {
          return noop({ ...ctx, error: "invite code required for p2p registration" });
        }
        return {
          ctx: { ...ctx, error: null },
          effects: [
            {
              type: "AUTH_REDEEM_INVITE",
              peerAddr: ctx.peerAddr,
              username: event.username,
              inviteCode: event.inviteCode,
            },
          ],
        };
      }
      return {
        ctx: { ...ctx, error: null },
        effects: [
          {
            type: "AUTH_HTTP",
            url: ctx.url,
            mode: event.mode,
            username: event.username,
            inviteCode: event.inviteCode,
          },
        ],
      };
    }

    case "PASSKEY_AUTH": {
      if (ctx.step !== "auth") return noop(ctx);
      if (event.mode === "register") {
        if (!ctx.peerAddr) {
          return noop({ ...ctx, error: "no peer address available" });
        }
        if (!event.inviteCode?.trim()) {
          return noop({ ...ctx, error: "invite code is required to register a new passkey" });
        }
        return {
          ctx: { ...ctx, error: null },
          effects: [
            {
              type: "AUTH_PASSKEY_REGISTER",
              peerAddr: ctx.peerAddr,
              username: event.username?.trim() || undefined,
              inviteCode: event.inviteCode.trim(),
            },
          ],
        };
      }
      return {
        ctx: { ...ctx, error: null },
        effects: [
          {
            type: "AUTH_PASSKEY_LOGIN",
            target: ctx.target ?? { type: "http", url: ctx.url },
            username: event.username?.trim() || undefined,
          },
        ],
      };
    }

    case "AUTH_RESULT": {
      if (ctx.step !== "auth") return noop(ctx);
      if (!event.ok) {
        return noop({ ...ctx, error: event.error ?? "authentication failed" });
      }
      return {
        ctx: { ...ctx, error: null },
        effects: [{ type: "CREATE_REMOTE", peerAddr: ctx.peerAddr, url: ctx.url }],
      };
    }

    case "REMOTE_CREATED": {
      if (!event.ok || !event.remote) {
        return noop(toUrlInput(ctx, event.error ?? "failed to save remote"));
      }
      return {
        ctx: { ...ctx, step: "complete", remote: event.remote, error: null, progress: null },
        effects: [
          { type: "DELETE_PENDING_BY_ADDR", peerAddr: addrKey(ctx) },
          { type: "SCHEDULE_TIMER", id: DISMISS_TIMER_ID, ms: COMPLETE_DISMISS_MS },
        ],
      };
    }

    case "COMPLETE_PEER_ADDR": {
      if (ctx.step === "complete") return noop(ctx);
      const matchesStaged = ctx.peerAddr === event.peerAddr;
      const matchesPending = ctx.pendingRemotes.some((p) => p.peer_addr === event.peerAddr);
      if (!matchesStaged && !matchesPending) return noop(ctx);
      return {
        ctx: {
          ...ctx,
          step: "testing",
          peerAddr: event.peerAddr,
          url: "",
          target: { type: "p2p", peerAddr: event.peerAddr },
          progress: "completing setup...",
          error: null,
        },
        effects: [{ type: "CREATE_REMOTE", peerAddr: event.peerAddr, url: "" }],
      };
    }

    case "RETRY_PENDING": {
      if (ctx.step !== "url") return noop(ctx);
      const { pending } = event;
      const knockStages = ["knock_pending", "knock_accepted", "knock_rejected"];
      if (!knockStages.includes(pending.stage)) {
        // not a knock: re-run the normal connection flow for its address
        return transition(
          { ...ctx, subStep: "input" },
          { type: "SUBMIT_URL", input: pending.peer_addr }
        );
      }
      const target = parsePeerAddress(pending.peer_addr) ?? {
        type: "p2p" as const,
        peerAddr: pending.peer_addr,
      };
      return {
        ctx: {
          ...ctx,
          step: "testing",
          input: pending.peer_addr,
          peerAddr: target.type === "p2p" ? target.peerAddr : null,
          url: target.type === "http" ? target.url : "",
          target,
          retryPending: pending,
          error: null,
          progress: "checking access request status...",
        },
        effects: [{ type: "CHECK_KNOCK_STATUS", pending }],
      };
    }

    case "KNOCK_STATUS_RESULT": {
      if (ctx.step !== "testing") return noop(ctx);
      const pending = ctx.retryPending;
      const { outcome } = event;
      switch (outcome.kind) {
        case "accepted_authed":
          return {
            ctx: {
              ...ctx,
              serverInfo: outcome.serverInfo ?? ctx.serverInfo,
              retryPending: null,
              progress: "creating remote...",
            },
            effects: [
              ...(pending ? [{ type: "DELETE_PENDING", id: pending.id } as const] : []),
              { type: "CREATE_REMOTE", peerAddr: ctx.peerAddr, url: ctx.url },
            ],
          };
        case "accepted_needs_auth":
          return {
            ctx: {
              ...ctx,
              step: "auth",
              serverInfo: outcome.serverInfo ?? ctx.serverInfo,
              retryPending: null,
              error: null,
              progress: null,
            },
            effects: pending ? [{ type: "DELETE_PENDING", id: pending.id }] : [],
          };
        case "denied":
          return {
            ctx: { ...toUrlInput(ctx, "your access request was rejected by the server admin"), retryPending: null },
            effects: pending
              ? [
                  {
                    type: "UPSERT_PENDING",
                    peerAddr: pending.peer_addr,
                    patch: { stage: "knock_rejected" },
                  },
                ]
              : [],
          };
        case "pending":
          return noop({
            ...toUrlInput(
              ctx,
              "access request is still pending - the server admin has not yet responded"
            ),
            retryPending: null,
          });
        case "unreachable":
          return noop({
            ...toUrlInput(ctx, "still waiting for access approval - server may be offline"),
            retryPending: null,
          });
      }
      break;
    }

    case "DELETE_PENDING":
      return {
        ctx,
        effects: [
          { type: "DELETE_PENDING", id: event.pending.id },
          { type: "LOAD_PENDING_REMOTES" },
        ],
      };

    case "BACK": {
      if (ctx.step === "auth" || ctx.step === "knock_sent") {
        return noop(toUrlInput(ctx, null));
      }
      if (ctx.step === "url" && ctx.subStep === "knock_form") {
        return noop(toUrlInput(ctx, null));
      }
      if (ctx.step === "testing") {
        return { ctx: toUrlInput(ctx, null), effects: [{ type: "CANCEL_IN_FLIGHT" }] };
      }
      return noop(ctx);
    }

    case "TIMER_FIRED": {
      if (event.id !== DISMISS_TIMER_ID || ctx.step !== "complete") return noop(ctx);
      const remote = ctx.remote!;
      return {
        ctx: initialContext(),
        effects: [{ type: "CALL_ON_CLOSE" }, { type: "CALL_ON_SUCCESS", remote }],
      };
    }
  }

  return noop(ctx);
}
