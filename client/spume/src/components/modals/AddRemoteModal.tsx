// add remote modal - multi-step wizard for adding a new remote server.
// drives the shared @freqhole/haruspex/flows AddPeerFlow state machine
// (address entry -> connection test -> knock request or auth -> saved
// remote) via addPeerFlowAdapter; this file owns only the ui skin plus a
// handful of concerns the shared flow doesn't model: the qr scanner, the
// "current origin might already be a server" hint, and the charnel
// system-browser link handoff.
import {
  Accessor,
  createEffect,
  createResource,
  createSignal,
  For,
  Match,
  on,
  Show,
  Switch,
} from "solid-js";
import type {
  AddPeerFlow,
  AddPeerState,
  PendingRemote,
  SavedRemote,
} from "@freqhole/haruspex/flows";
import { createAddPeerFlow } from "@freqhole/haruspex/flows";
import { getLocalNodeId, getLocalNodeIdAsync, isCharnelAvailable } from "../../app/api/client";
import { addPeerFlowDeps } from "../../app/services/remotes/addPeerFlowAdapter";
import { getServerInfo } from "../../app/services/remotes/authService";
import { getAllRemotes } from "../../app/services/remotes/remoteManager";
import { getPendingRemoteByPeerAddr } from "../../app/services/storage/db";
import { resolveBlobUrl } from "../../music/services/storage/blobResolver";
import { debug } from "../../utils/logger";
import { AuthForm } from "../auth/AuthForm";
import { Button } from "../buttons/Button";
import { QrScanner } from "../inputs/QrScanner";
import { MediaImage } from "../media/MediaImage";

export interface AddRemoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (remote: SavedRemote) => void;
  /** initial value to pre-fill the input (e.g., from ?r= query param) */
  initialValue?: string;
  /**
   * when set to a peer_addr, the modal will auto-complete the setup for that
   * peer. used by App.tsx to drive completion from device-linked / knock-accepted
   * events without the user having to click "continue setup".
   */
  completePeerAddr?: Accessor<string | null>;
}

/** resolve a server's hello image to a renderable url, for the current
 *  in-progress attempt. reuses the same generic p2p/http blob resolver
 *  every other remote-hosted image in this app goes through - the pending
 *  remote's own row (already persisted by the flow's UPSERT_PENDING
 *  effect by the time this is called) supplies the "pending-<id>"
 *  addressing blobResolver needs. */
async function resolveServerImageUrl(
  peerAddr: string | null,
  url: string,
  imageBlobId: string | null | undefined
): Promise<string | null> {
  if (!imageBlobId) return null;
  const key = peerAddr ?? url;
  if (!key) return null;
  const pending = await getPendingRemoteByPeerAddr(key);
  if (!pending) return null;
  try {
    return await resolveBlobUrl(imageBlobId, `pending-${pending.id}`, "image");
  } catch (err) {
    debug("AddRemoteModal", "server image resolve failed:", err);
    return null;
  }
}

export function AddRemoteModal(props: AddRemoteModalProps) {
  const flow: AddPeerFlow = createAddPeerFlow(addPeerFlowDeps);
  const [state, setState] = createSignal<AddPeerState>(flow.state());

  const dispatch = async (event: Parameters<AddPeerFlow["dispatch"]>[0]) => {
    await flow.dispatch(event);
    setState(flow.state());
  };

  // hint: if current origin is a valid remote server that's not already added
  const [originHint, setOriginHint] = createSignal<string | null>(null);

  // qr scanner state (browser-only, not in tauri)
  const [showScanner, setShowScanner] = createSignal(false);
  const canScanQr = () => !isCharnelAvailable() && !!navigator.mediaDevices?.getUserMedia;

  // charnel mode: link to complete passkey auth in the system browser.
  // generates a ?link= url for spume's /link route. never actually shown
  // today (showCharnelLink has no setter that turns it on) - preserved
  // exactly as the prior implementation left it, not "fixed" here, since
  // the intended trigger condition was never specified.
  const [showCharnelLink] = createSignal(false);
  const [charnelLinkCopied, setCharnelLinkCopied] = createSignal(false);
  const [localNodeId, setLocalNodeId] = createSignal<string | null>(null);
  createEffect(() => {
    if (props.isOpen && isCharnelAvailable()) {
      void getLocalNodeIdAsync().then(setLocalNodeId);
    }
  });
  const charnelSpumeLink = () => {
    const s = state();
    const peer = s.step === "url" || s.step === "testing" || s.step === "auth" ? s.peerAddr : null;
    if (!peer) return null;
    const info = s.step === "url" || s.step === "auth" ? s.serverInfo : null;
    const clientNodeId = localNodeId() ?? getLocalNodeId();
    const payload: Record<string, unknown> = {
      peer_addr: peer,
      name: info?.name ?? "freqhole",
      description: info?.description ?? null,
    };
    if (clientNodeId) payload.link_node_id = clientNodeId;
    return `https://spume.freqhole.net/?link=${btoa(JSON.stringify(payload))}`;
  };
  const handleCharnelLinkCopy = () => {
    const link = charnelSpumeLink();
    if (!link) return;
    void navigator.clipboard.writeText(link).then(() => {
      setCharnelLinkCopied(true);
      setTimeout(() => setCharnelLinkCopied(false), 2000);
    });
  };
  const handleCharnelLinkOpen = () => {
    const link = charnelSpumeLink();
    if (link) window.open(link, "_blank");
  };

  // reactively resolve the current attempt's server image whenever the
  // flow enters a step that has server info with an image to show.
  const [serverImageUrl] = createResource(
    () => {
      const s = state();
      if (s.step === "url" && s.subStep === "knock_form") {
        return { peerAddr: s.peerAddr, url: "", blobId: s.serverInfo?.image_blob_id };
      }
      if (s.step === "auth") {
        return { peerAddr: s.peerAddr, url: s.url, blobId: s.serverInfo?.image_blob_id };
      }
      return null;
    },
    async (input) => (input ? resolveServerImageUrl(input.peerAddr, input.url, input.blobId) : null)
  );

  // open the flow (loads pending remotes) whenever the modal opens, with
  // any pre-filled value (e.g. from a ?r= query param)
  createEffect(
    on(
      () => props.isOpen,
      (isOpen) => {
        if (isOpen) void dispatch({ type: "MODAL_OPEN", initialInput: props.initialValue });
      }
    )
  );

  // auto-complete setup when a device-linked / knock-accepted event arrives
  // for the peer the modal is currently working with
  createEffect(
    on(
      () => props.completePeerAddr?.(),
      async (triggerAddr) => {
        if (!triggerAddr || !props.isOpen) return;
        await dispatch({ type: "COMPLETE_PEER_ADDR", peerAddr: triggerAddr });
      }
    )
  );

  // check if current origin could be a remote server when modal opens
  createEffect(
    on(
      () => props.isOpen,
      async (isOpen) => {
        if (!isOpen) return;

        const origin = window.location.origin;
        try {
          const existingRemotes = await getAllRemotes();
          if (existingRemotes.some((r) => r.base_url === origin)) {
            setOriginHint(null);
            return;
          }

          const helloResult = await getServerInfo(origin);
          setOriginHint(helloResult.success && helloResult.data?.name ? origin : null);
        } catch {
          setOriginHint(null);
        }
      }
    )
  );

  const isBusy = () => {
    const s = state();
    return s.step === "testing" && s.progress !== null;
  };

  const handleClose = () => {
    const s = state();
    // allow close during testing (cancels the connection), but not during auth
    if (s.step !== "testing" && isBusy()) return;
    setOriginHint(null);
    void dispatch({ type: "MODAL_CLOSE" });
    props.onClose();
  };

  // once REMOTE_CREATED lands, dismiss + notify after the flow's own
  // auto-dismiss timer (COMPLETE_DISMISS_MS, scheduled by the machine
  // itself) - watch for the transition into "complete" and act once.
  createEffect(
    on(
      () => {
        const s = state();
        return s.step === "complete" ? s.remote : null;
      },
      (remote) => {
        if (!remote) return;
        setTimeout(() => {
          props.onClose();
          props.onSuccess?.(remote);
        }, 1500);
      }
    )
  );

  const canGoBack = () => {
    const s = state();
    return s.step === "auth" || s.step === "knock_sent" || s.step === "testing";
  };

  const handleBack = () => {
    void dispatch({ type: "BACK" });
  };

  const handleTestConnection = (input: string) => {
    void dispatch({ type: "SUBMIT_URL", input });
  };

  const handleRequestAccess = (username: string, message: string) => {
    void dispatch({ type: "SUBMIT_KNOCK", username, message });
  };

  const handleAuth = (data: {
    username: string;
    inviteCode?: string;
    mode: "login" | "register";
  }) => {
    void dispatch({ type: "SUBMIT_AUTH", ...data });
  };

  const handlePasskeyAuth = (data: {
    username: string;
    inviteCode?: string;
    mode: "login" | "register";
  }) => {
    void dispatch({ type: "PASSKEY_AUTH", ...data });
  };

  const handleRetryPending = (pending: PendingRemote) => {
    void dispatch({ type: "RETRY_PENDING", pending });
  };

  const handleDeletePending = (pending: PendingRemote) => {
    void dispatch({ type: "DELETE_PENDING", pending });
  };

  return (
    <Show when={props.isOpen}>
      {/* QR scanner overlay */}
      <Show when={showScanner()}>
        <QrScanner
          onResult={(text) => {
            setShowScanner(false);
            debug("AddRemoteModal", `QR scanned: ${text.slice(0, 16)}...`);
            // fill the peer id/url field and kick off the same connection
            // test a manually-typed + submitted value would trigger. the
            // "url" step's input box is local state (see the "url" Match
            // block below) with no wiring back to this handler, so
            // dispatching QR_SCAN alone (which only updates the machine's
            // internal ctx.input, never projected into AddPeerState) left
            // the scan looking like a no-op.
            handleTestConnection(text);
          }}
          onError={(err) => {
            debug("AddRemoteModal", `QR scan error: ${err}`);
          }}
          onClose={() => setShowScanner(false)}
        />
      </Show>

      {/* backdrop */}
      <div
        class="bg-black/50 flex items-center justify-center p-0 wide:p-4"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          "z-index": 1050,
          "margin-top": "var(--safe-area-top, 0px)",
          height: "calc(100% - var(--safe-area-top, 0px))",
        }}
      >
        {/* modal */}
        <div class="bg-[var(--color-bg-primary)] shadow-xl w-full wide:border wide:border-[var(--color-border-default)] flex flex-col h-full wide:rounded-lg wide:max-w-md wide:max-h-[80dvh] wide:h-auto">
          {/* header */}
          <div class="flex items-center justify-between p-6 border-b border-[var(--color-border-default)] flex-shrink-0">
            <div class="flex items-center gap-3">
              <Show when={canGoBack()}>
                <button
                  type="button"
                  class="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                  onClick={handleBack}
                >
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                </button>
              </Show>
              <h2 class="text-xl font-bold text-[var(--color-text-primary)]">add remote server</h2>
            </div>
            <button
              type="button"
              class="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              onClick={handleClose}
              disabled={isBusy()}
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* content */}
          <div class="p-6 overflow-y-auto flex-1 min-h-0">
            <Switch>
              {/* step 1: enter url (or the knock request form, a sub-step of "url") */}
              <Match when={state().step === "url"}>
                {(() => {
                  const s = state() as Extract<AddPeerState, { step: "url" }>;
                  const [inputValue, setInputValue] = createSignal("");
                  return (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (s.subStep === "knock_form") {
                          const form = e.currentTarget;
                          const usernameInput =
                            form.querySelector<HTMLInputElement>("#knock-username");
                          const messageInput =
                            form.querySelector<HTMLTextAreaElement>("#knock-message");
                          const username = usernameInput?.value?.trim() || "";
                          const message = messageInput?.value?.trim() || "";
                          if (!username || !message) return;
                          handleRequestAccess(username, message);
                        } else {
                          handleTestConnection(inputValue());
                        }
                      }}
                      class="space-y-4"
                    >
                      <div>
                        <label
                          for="remote-url"
                          class="block text-sm font-medium text-[var(--color-text-primary)] mb-2"
                        >
                          server url or peer id
                        </label>
                        <div class="flex gap-2">
                          <input
                            id="remote-url"
                            type="text"
                            value={inputValue()}
                            onInput={(e) => setInputValue(e.currentTarget.value)}
                            placeholder="https://music.example.com or node_id"
                            class="flex-1 px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-md text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)] focus:border-transparent font-mono text-sm"
                            disabled={s.subStep === "knock_form"}
                          />
                          <Show when={canScanQr()}>
                            <button
                              type="button"
                              onClick={() => setShowScanner(true)}
                              disabled={s.subStep === "knock_form"}
                              class="px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-md text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-accent-primary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title="scan QR code"
                            >
                              <svg
                                class="w-5 h-5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h2M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                                />
                              </svg>
                            </button>
                          </Show>
                        </div>
                        <p class="mt-1 text-xs text-[var(--color-text-tertiary)]">
                          enter a URL for HTTP, or paste a 64-char node_id for P2P
                        </p>
                      </div>

                      <Show when={s.error}>
                        <div class="p-3 bg-[var(--color-status-error)]/10 border border-[var(--color-status-error)] rounded-md">
                          <p class="text-sm text-[var(--color-status-error)]">{s.error}</p>
                        </div>
                      </Show>

                      {/* request access form - shown when knocking is enabled */}
                      <Show when={s.subStep === "knock_form"}>
                        <Show when={s.serverInfo}>
                          <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-md">
                            <div class="flex items-start gap-3">
                              <MediaImage
                                imageUrl={serverImageUrl() ?? null}
                                alt={s.serverInfo?.name ?? "Server"}
                                class="w-12 h-12 rounded object-cover"
                              />
                              <div class="flex-1 min-w-0">
                                <p class="text-sm font-medium text-[var(--color-text-primary)]">
                                  {s.serverInfo?.name}
                                </p>
                                <Show when={s.serverInfo?.description}>
                                  <p class="text-xs text-[var(--color-text-secondary)] mt-0.5">
                                    {s.serverInfo?.description}
                                  </p>
                                </Show>
                                <p class="text-xs text-[var(--color-text-tertiary)] mt-1">
                                  P2P • version {s.serverInfo?.version}
                                </p>
                              </div>
                            </div>
                          </div>
                        </Show>

                        <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-md space-y-3">
                          <p class="text-sm text-[var(--color-text-secondary)]">
                            request access to this server. the admin will review your request.
                          </p>
                          <div>
                            <label
                              for="knock-username"
                              class="block text-xs font-medium text-[var(--color-text-primary)] mb-1"
                            >
                              your name
                            </label>
                            <input
                              id="knock-username"
                              type="text"
                              placeholder="how should we address you?"
                              class="w-full px-2 py-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)]"
                            />
                          </div>
                          <div>
                            <label
                              for="knock-message"
                              class="block text-xs font-medium text-[var(--color-text-primary)] mb-1"
                            >
                              message
                            </label>
                            <textarea
                              id="knock-message"
                              placeholder="say who you are and mention something only the admin would know (but no passwords or secrets!)"
                              rows={3}
                              class="w-full px-2 py-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border-default)] rounded text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-primary)] resize-none"
                            />
                          </div>
                        </div>
                      </Show>

                      <Show when={s.subStep !== "knock_form"}>
                        <Button type="submit" variant="primary" class="w-full">
                          test connection
                        </Button>
                      </Show>
                      <Show when={s.subStep === "knock_form"}>
                        <div class="flex gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void dispatch({ type: "CANCEL_KNOCK" })}
                            class="flex-1"
                          >
                            cancel
                          </Button>
                          <Button type="submit" variant="primary" class="flex-1">
                            request access
                          </Button>
                        </div>
                      </Show>

                      {/* let users with an invite code skip the knock
                              flow and go straight to register/login. */}
                      <Show when={s.subStep === "knock_form" && s.peerAddr && s.serverInfo}>
                        <div class="text-center pt-4 border-t border-[var(--color-border-default)]">
                          <p class="text-sm text-[var(--color-text-secondary)] mb-2">
                            have an invite code?{" "}
                            <button
                              type="button"
                              class="text-sm text-[var(--color-accent-primary)] hover:underline"
                              onClick={() => void dispatch({ type: "USE_INVITE_CODE" })}
                            >
                              use it to register
                            </button>
                          </p>
                          <Show when={s.serverInfo?.passkey_p2p_enabled}>
                            <button
                              type="button"
                              class="w-full mt-1 py-2 text-sm font-medium rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
                              onClick={() => void dispatch({ type: "PASSKEY_SIGNIN" })}
                            >
                              sign in with passkey
                            </button>
                          </Show>
                          <Show when={isCharnelAvailable() && showCharnelLink()}>
                            <div class="space-y-2 mt-2">
                              <div class="flex gap-2">
                                <input
                                  type="text"
                                  readOnly
                                  value={charnelSpumeLink() ?? ""}
                                  class="flex-1 px-3 py-2 text-xs rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] select-all cursor-text"
                                  onClick={(e) => (e.target as HTMLInputElement).select()}
                                />
                              </div>
                              <div class="flex gap-2">
                                <button
                                  type="button"
                                  class="flex-1 py-2 text-sm font-medium rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
                                  onClick={handleCharnelLinkCopy}
                                >
                                  {charnelLinkCopied() ? "copied!" : "copy link"}
                                </button>
                                <button
                                  type="button"
                                  class="flex-1 py-2 text-sm font-medium rounded-lg bg-[var(--color-accent-primary)] text-white hover:opacity-90 transition-opacity"
                                  onClick={handleCharnelLinkOpen}
                                >
                                  open in browser
                                </button>
                              </div>
                            </div>
                          </Show>
                        </div>
                      </Show>
                      {/* hint: use current origin if it's a valid server */}
                      <Show when={originHint() && s.subStep !== "knock_form"}>
                        <div class="text-center pt-2 border-t border-[var(--color-border-default)]">
                          <button
                            type="button"
                            class="text-sm text-[var(--color-accent-primary)] hover:underline"
                            onClick={() => {
                              setInputValue(originHint()!);
                              handleTestConnection(originHint()!);
                            }}
                          >
                            use {originHint()}
                          </button>
                        </div>
                      </Show>

                      {/* pending remotes list */}
                      <Show when={s.pendingRemotes.length > 0}>
                        <div class="pt-4 border-t border-[var(--color-border-default)]">
                          <h3 class="text-sm font-medium text-[var(--color-text-primary)] mb-2">
                            pending connections
                          </h3>
                          <div class="space-y-2">
                            <For each={s.pendingRemotes}>
                              {(pending) => (
                                <div class="flex items-center gap-2 p-2 bg-[var(--color-bg-secondary)] rounded border border-[var(--color-border-default)]">
                                  {/* server image */}
                                  <div class="w-10 h-10 rounded overflow-hidden flex-shrink-0 bg-[var(--color-bg-tertiary)]">
                                    <Show
                                      when={pending.server_image_data}
                                      fallback={
                                        <div class="w-full h-full flex items-center justify-center text-[var(--color-text-tertiary)]">
                                          <svg
                                            class="w-5 h-5"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                          >
                                            <path
                                              stroke-linecap="round"
                                              stroke-linejoin="round"
                                              stroke-width="1.5"
                                              d="M5 12h14M12 5l7 7-7 7"
                                            />
                                          </svg>
                                        </div>
                                      }
                                    >
                                      <img
                                        src={`data:${pending.server_image_type || "image/png"};base64,${pending.server_image_data}`}
                                        alt={pending.server_name || "server"}
                                        class="w-full h-full object-cover"
                                      />
                                    </Show>
                                  </div>
                                  <div class="flex-1 min-w-0">
                                    <p class="text-sm font-medium text-[var(--color-text-primary)] truncate">
                                      {pending.server_name ||
                                        pending.peer_addr.slice(0, 16) + "..."}
                                    </p>
                                    <p class="text-xs text-[var(--color-text-tertiary)]">
                                      {pending.stage === "testing" && "testing connection..."}
                                      {pending.stage === "connected" && "ready to connect"}
                                      {pending.stage === "failed" && (
                                        <span class="text-[var(--color-status-error)]">
                                          connection failed
                                        </span>
                                      )}
                                      {pending.stage === "knock_pending" && "waiting for approval"}
                                      {pending.stage === "knock_accepted" && "access granted"}
                                      {pending.stage === "knock_rejected" && "request rejected"}
                                    </p>
                                    <Show
                                      when={pending.stage === "failed" && pending.error_message}
                                    >
                                      <p
                                        class="text-xs text-[var(--color-status-error)] mt-0.5 truncate"
                                        title={pending.error_message ?? undefined}
                                      >
                                        {pending.error_message}
                                      </p>
                                    </Show>
                                  </div>
                                  <div class="flex gap-1">
                                    <button
                                      type="button"
                                      class="p-1.5 cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-accent-primary)] hover:bg-[var(--color-accent-primary)]/10 rounded transition-colors"
                                      onClick={() => handleRetryPending(pending)}
                                      title={
                                        pending.stage === "connected"
                                          ? "continue setup"
                                          : pending.stage === "failed" ||
                                              pending.stage === "testing"
                                            ? "retry connection"
                                            : "check status"
                                      }
                                      disabled={pending.stage === "testing"}
                                    >
                                      <svg
                                        class="w-4 h-4"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          stroke-linecap="round"
                                          stroke-linejoin="round"
                                          stroke-width="2"
                                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                        />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      class="p-1.5 cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-accent-primary)] hover:bg-[var(--color-accent-primary)]/10 rounded transition-colors"
                                      onClick={() => handleDeletePending(pending)}
                                      title="remove"
                                    >
                                      <svg
                                        class="w-4 h-4"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                      >
                                        <path
                                          stroke-linecap="round"
                                          stroke-linejoin="round"
                                          stroke-width="2"
                                          d="M6 18L18 6M6 6l12 12"
                                        />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                    </form>
                  );
                })()}
              </Match>

              {/* step 2: testing connection */}
              <Match when={state().step === "testing"}>
                {(() => {
                  const s = state() as Extract<AddPeerState, { step: "testing" }>;
                  return (
                    <div class="flex flex-col items-center justify-center py-8 space-y-4">
                      <div class="w-12 h-12 border-4 border-[var(--color-accent-primary)] border-t-transparent rounded-full animate-spin" />
                      <p class="text-sm text-[var(--color-text-secondary)]">
                        {s.progress ||
                          (s.peerAddr
                            ? `connecting via P2P to ${s.peerAddr.slice(0, 16)}...`
                            : `connecting to ${s.url}...`)}
                      </p>
                    </div>
                  );
                })()}
              </Match>

              {/* step 3: authenticate */}
              <Match when={state().step === "auth"}>
                {(() => {
                  const s = state() as Extract<AddPeerState, { step: "auth" }>;
                  return (
                    <div class="space-y-4">
                      {/* server info display - show if available */}
                      <Show when={s.serverInfo}>
                        <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-md">
                          <div class="flex items-start gap-3">
                            <MediaImage
                              imageUrl={serverImageUrl() ?? null}
                              alt={s.serverInfo?.name ?? "Server"}
                              class="w-12 h-12 rounded object-cover"
                            />
                            <div class="flex-1 min-w-0">
                              <p class="text-sm font-medium text-[var(--color-text-primary)]">
                                {s.serverInfo?.name}
                              </p>
                              <Show when={s.serverInfo?.description}>
                                <p class="text-xs text-[var(--color-text-secondary)] mt-0.5">
                                  {s.serverInfo?.description}
                                </p>
                              </Show>
                              <p class="text-xs text-[var(--color-text-tertiary)] mt-1">
                                {s.peerAddr && <span>P2P • </span>}
                                version {s.serverInfo?.version}
                              </p>
                            </div>
                          </div>
                        </div>
                      </Show>

                      {/* P2P-specific info when no server info */}
                      <Show when={s.peerAddr && !s.serverInfo}>
                        <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-md">
                          <p class="text-sm text-[var(--color-text-secondary)]">
                            P2P peer: <code class="text-xs">{s.peerAddr!.slice(0, 16)}...</code>
                          </p>
                          <p class="text-xs text-[var(--color-text-tertiary)] mt-2">
                            register with an invite code to connect
                          </p>
                        </div>
                      </Show>

                      <AuthForm
                        initialMode={s.peerAddr ? "register" : "login"}
                        onSubmit={handleAuth}
                        onPasskeyClick={handlePasskeyAuth}
                        error={s.error || undefined}
                        showModeToggle={!s.peerAddr}
                        hidePasskeyInfo={!!s.peerAddr || isCharnelAvailable()}
                        hidePasskeyButton={!s.peerAddr && isCharnelAvailable()}
                      />

                      {/* request access option for P2P when knocking is enabled */}
                      <Show
                        when={
                          s.peerAddr &&
                          (s.serverInfo?.knocking_enabled || s.serverInfo?.passkey_p2p_enabled)
                        }
                      >
                        <div class="text-center pt-4 border-t border-[var(--color-border-default)]">
                          <Show when={s.serverInfo?.knocking_enabled}>
                            <p class="text-sm text-[var(--color-text-secondary)] mb-2">
                              don't have an invite code?
                            </p>
                            <button
                              type="button"
                              class="text-sm text-[var(--color-accent-primary)] hover:underline"
                              onClick={() => void dispatch({ type: "BACK" })}
                            >
                              request access from the admin
                            </button>
                          </Show>
                          <Show when={s.serverInfo?.passkey_p2p_enabled}>
                            <Show when={isCharnelAvailable() && showCharnelLink()}>
                              <div class="space-y-2 mt-2">
                                <div class="flex gap-2">
                                  <input
                                    type="text"
                                    readOnly
                                    value={charnelSpumeLink() ?? ""}
                                    class="flex-1 px-3 py-2 text-xs rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] select-all cursor-text"
                                    onClick={(e) => (e.target as HTMLInputElement).select()}
                                  />
                                </div>
                                <div class="flex gap-2">
                                  <button
                                    type="button"
                                    class="flex-1 py-2 text-sm font-medium rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
                                    onClick={handleCharnelLinkCopy}
                                  >
                                    {charnelLinkCopied() ? "copied!" : "copy link"}
                                  </button>
                                  <button
                                    type="button"
                                    class="flex-1 py-2 text-sm font-medium rounded-lg bg-[var(--color-accent-primary)] text-white hover:opacity-90 transition-opacity"
                                    onClick={handleCharnelLinkOpen}
                                  >
                                    open in browser
                                  </button>
                                </div>
                              </div>
                            </Show>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  );
                })()}
              </Match>

              {/* step: knock sent - waiting for approval */}
              <Match when={state().step === "knock_sent"}>
                <div class="flex flex-col items-center justify-center py-8 space-y-4">
                  <div class="w-16 h-16 rounded-full bg-[var(--color-accent-primary)]/10 flex items-center justify-center">
                    <svg
                      class="w-8 h-8 text-[var(--color-accent-primary)]"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                  <div class="text-center">
                    <h3 class="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                      access request sent!
                    </h3>
                    <p class="text-sm text-[var(--color-text-secondary)] mb-4">
                      the server admin will review your request.
                      <br />
                      check back later to see if it was approved.
                    </p>
                    <Button variant="secondary" onClick={handleBack}>
                      done
                    </Button>
                  </div>
                </div>
              </Match>

              {/* step 4: complete */}
              <Match when={state().step === "complete"}>
                {(() => {
                  const s = state() as Extract<AddPeerState, { step: "complete" }>;
                  return (
                    <div class="flex flex-col items-center justify-center py-8 space-y-4">
                      <div class="w-16 h-16 rounded-full bg-[var(--color-status-success)]/10 flex items-center justify-center">
                        <svg
                          class="w-8 h-8 text-[var(--color-status-success)]"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fill-rule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clip-rule="evenodd"
                          />
                        </svg>
                      </div>
                      <div class="text-center">
                        <h3 class="text-lg font-semibold text-[var(--color-text-primary)] mb-1">
                          remote added!
                        </h3>
                        <p class="text-sm text-[var(--color-text-secondary)]">
                          {s.remote.peer_addr
                            ? `P2P peer ${s.remote.peer_addr.slice(0, 16)}... is ready`
                            : `${s.remote.base_url} is ready to use`}
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </Match>
            </Switch>
          </div>
        </div>
      </div>
    </Show>
  );
}
