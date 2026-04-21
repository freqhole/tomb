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
  createSignal,
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

interface AdminTransportContextValue {
  /** currently selected target info */
  current: Accessor<AdminTargetInfo>;
  /** swap targets. pass `LOCAL_TARGET` (or `{ kind: "local", label: "local" }`)
   *  to go back to local. */
  setCurrent: Setter<AdminTargetInfo>;
  /** is the current target remote? convenience */
  isRemote: Accessor<boolean>;
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

  function targetForDispatch(): AdminTarget {
    const t = current();
    if (t.kind === "remote" && t.peerAddr) {
      return { kind: "remote", peerAddr: t.peerAddr };
    }
    return { kind: "local" };
  }

  const value: AdminTransportContextValue = {
    current,
    setCurrent,
    isRemote: () => current().kind === "remote",
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
