// active admin transport context
//
// holds the wizard's currently-selected admin target (local or a remote
// pulled from the `remotez` registry) and exposes a `dispatch()` bound to
// it. views call `useAdminTransport().dispatch(...)` instead of importing
// the raw transport module, so a single dropdown change retargets every
// admin call.
//
// this context is intentionally tiny — connection lifecycle, knock flows,
// etc. live elsewhere. see docs/wizard-remote-admin.md.

import {
  createContext,
  createEffect,
  createSignal,
  on,
  useContext,
  type Accessor,
  type JSX,
  type Setter,
} from "solid-js";
import {
  dispatch as rawDispatch,
  dispatchOrThrow as rawDispatchOrThrow,
  type AdminResponse,
  type AdminTarget,
} from "./transport";

/** display info for a target. `kind` mirrors `AdminTarget`. */
export interface AdminTargetInfo {
  kind: "local" | "remote";
  /** human-readable label shown in the dropdown / scope banner */
  label: string;
  /** for remote targets: peer address (node id or endpoint json) */
  peerAddr?: string;
  /** for remote targets: short id used for compact display */
  shortId?: string;
}

const LOCAL_TARGET: AdminTargetInfo = {
  kind: "local",
  label: "local",
};

/** connection lifecycle status for the active target. */
export type AdminTargetStatus =
  | "idle"
  | "connecting"
  | "online"
  | "offline"
  | "unauthorized";

interface AdminTransportContextValue {
  /** currently selected target info */
  current: Accessor<AdminTargetInfo>;
  /** swap targets. pass `LOCAL_TARGET` (or `{ kind: "local", label: "local" }`)
   *  to go back to local. */
  setCurrent: Setter<AdminTargetInfo>;
  /** is the current target remote? convenience */
  isRemote: Accessor<boolean>;
  /** lifecycle status for the active target. local is always `online`. */
  status: Accessor<AdminTargetStatus>;
  /** human-readable error from the last failed connection probe, if any. */
  statusError: Accessor<string | null>;
  /** dispatch a command against the current target */
  dispatch<T = unknown>(
    command: string,
    args?: unknown,
  ): Promise<AdminResponse<T>>;
  /** dispatch + unwrap data, throwing on failure */
  dispatchOrThrow<T = unknown>(command: string, args?: unknown): Promise<T>;
}

const AdminTransportContext = createContext<AdminTransportContextValue>();

export function AdminTransportProvider(props: { children: JSX.Element }) {
  const [current, setCurrent] = createSignal<AdminTargetInfo>(LOCAL_TARGET);
  const [status, setStatus] = createSignal<AdminTargetStatus>("online");
  const [statusError, setStatusError] = createSignal<string | null>(null);

  function targetForDispatch(): AdminTarget {
    const t = current();
    if (t.kind === "remote" && t.peerAddr) {
      return { kind: "remote", peerAddr: t.peerAddr };
    }
    return { kind: "local" };
  }

  // probe reachability whenever the active target changes
  createEffect(
    on(current, async (t) => {
      if (t.kind === "local") {
        setStatus("online");
        setStatusError(null);
        return;
      }
      if (!t.peerAddr) {
        setStatus("offline");
        setStatusError("missing peer address");
        return;
      }
      setStatus("connecting");
      setStatusError(null);
      try {
        const response = await rawDispatch(
          "server_info",
          {},
          {
            kind: "remote",
            peerAddr: t.peerAddr,
          },
        );
        if (response.success) {
          setStatus("online");
          setStatusError(null);
        } else {
          const errType = response.errors?.[0]?.error_type;
          if (errType === "unauthorized" || errType === "forbidden") {
            setStatus("unauthorized");
          } else {
            setStatus("offline");
          }
          setStatusError(response.message || "verification failed");
        }
      } catch (e) {
        const msg = String(e);
        if (/unauthor|forbid|admin/i.test(msg)) {
          setStatus("unauthorized");
        } else {
          setStatus("offline");
        }
        setStatusError(msg);
      }
    }),
  );

  const value: AdminTransportContextValue = {
    current,
    setCurrent,
    isRemote: () => current().kind === "remote",
    status,
    statusError,
    dispatch: <T,>(command: string, args: unknown = null) =>
      rawDispatch<T>(command, args, targetForDispatch()),
    dispatchOrThrow: <T,>(command: string, args: unknown = null) =>
      rawDispatchOrThrow<T>(command, args, targetForDispatch()),
  };

  return (
    <AdminTransportContext.Provider value={value}>
      {props.children}
    </AdminTransportContext.Provider>
  );
}

export function useAdminTransport(): AdminTransportContextValue {
  const ctx = useContext(AdminTransportContext);
  if (!ctx) {
    throw new Error(
      "useAdminTransport called outside <AdminTransportProvider>",
    );
  }
  return ctx;
}

export { LOCAL_TARGET };
