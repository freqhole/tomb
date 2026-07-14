// solid-js integration module: headless auth-form/reauth-flow/auth-status/
// knock-inbox state primitives (behavior + accessibility-relevant state
// only, zero markup or styling opinions - consumers render their own
// components around these), and the AddPeerFlow FSM lives in ./flows for
// a rendered shell to be built over later. solid-js is an optional peer
// dep - keep this the only subpath that imports it.

export {
  createAuthForm,
  type AuthMode,
  type AuthFormData,
  type AuthFormDeps,
  type AuthFormState,
} from "./auth-form.js";
export {
  createReauthFlow,
  type ReauthFlowDeps,
  type ReauthFlowState,
} from "./reauth-flow.js";
export { createAuthStatus, type AuthStatusStore } from "./auth-status.js";
export {
  createKnockInbox,
  type KnockAcceptDecision,
  type KnockRowError,
  type KnockInboxDeps,
  type KnockInboxState,
} from "./knock-inbox.js";
