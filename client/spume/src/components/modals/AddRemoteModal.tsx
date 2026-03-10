// add remote modal - multi-step wizard for adding a new remote server
// steps: 1) enter url/peer, 2) test connection, 3) authenticate, 4) complete
import { createEffect, createSignal, Match, on, Show, Switch } from "solid-js";
import { getClientForRemote, isTauriAvailable } from "../../app/api/client";
import { authenticate, getServerInfo, whoami } from "../../app/services/remotes/authService";
import { createRemote, getAllRemotes } from "../../app/services/remotes/remoteManager";
import { AuthForm } from "../auth/AuthForm";
import { Button } from "../buttons/Button";
import { MediaImage } from "../media/MediaImage";
import { debug } from "../../utils/logger";

// format error messages from API responses
// handles Zod validation errors (JSON arrays) and plain strings
function formatErrorMessage(error: unknown): string {
  if (!error) return "unknown error";

  const errorStr = String(error);

  // try to parse as JSON array (Zod validation errors)
  try {
    const parsed = JSON.parse(errorStr);
    if (Array.isArray(parsed)) {
      // extract messages from Zod-style error objects
      const messages = parsed
        .map((e) => {
          if (typeof e === "object" && e !== null) {
            // prefer 'message' field
            if (e.message) return String(e.message);
            // fallback to stringifying
            return JSON.stringify(e);
          }
          return String(e);
        })
        .filter((msg) => msg && msg.length > 0);

      if (messages.length > 0) {
        return messages.join("; ");
      }
    } else if (typeof parsed === "object" && parsed !== null) {
      // single error object
      if (parsed.message) return String(parsed.message);
      if (parsed.detail) return String(parsed.detail);
      if (parsed.error) return String(parsed.error);
    }
  } catch {
    // not JSON, use as-is
  }

  return errorStr;
}

// detect if input is a P2P peer address (node_id or JSON endpoint)
function parsePeerAddress(
  input: string
): { type: "p2p"; peer_addr: string } | { type: "http"; url: string } | null {
  const trimmed = input.trim();

  // 64 hex characters = node_id
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    return { type: "p2p", peer_addr: trimmed };
  }

  // JSON blob with id field = full endpoint
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.id && typeof parsed.id === "string") {
        return { type: "p2p", peer_addr: trimmed };
      }
    } catch {
      // not valid JSON, fall through
    }
  }

  // otherwise treat as URL
  return { type: "http", url: trimmed };
}

export interface AddRemoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (remote: { remote_id: string; name: string; base_url?: string; peer_addr?: string }) => void;
}

type Step = "url" | "testing" | "auth" | "complete";

export function AddRemoteModal(props: AddRemoteModalProps) {
  const [step, setStep] = createSignal<Step>("url");
  const [url, setUrl] = createSignal("");
  const [peerAddr, setPeerAddr] = createSignal<string | null>(null); // set when input is P2P
  const [error, setError] = createSignal<string | null>(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [abortController, setAbortController] = createSignal<AbortController | null>(null);
  const [serverInfo, setServerInfo] = createSignal<{
    server_id: string;
    name: string;
    description?: string | null;
    version: string;
    image_url?: string | null;
    requiresAuth: boolean;
  } | null>(null);

  // hint: if current origin is a valid remote server that's not already added
  const [originHint, setOriginHint] = createSignal<string | null>(null);

  // check if current origin could be a remote server when modal opens
  createEffect(
    on(
      () => props.isOpen,
      async (isOpen) => {
        if (!isOpen) return;

        const origin = window.location.origin;
        try {
          // check if already added
          const existingRemotes = await getAllRemotes();
          if (existingRemotes.some((r) => r.base_url === origin)) {
            setOriginHint(null);
            return;
          }

          // try to hit the hello endpoint
          const helloResult = await getServerInfo(origin);
          if (helloResult.success && helloResult.data?.server_id) {
            setOriginHint(origin);
          } else {
            setOriginHint(null);
          }
        } catch {
          // not a valid server, ignore
          setOriginHint(null);
        }
      }
    )
  );

  // step 1: collect url/peer and test connection
  const handleTestConnection = async () => {
    setError(null);
    setPeerAddr(null);

    const input = url().trim();

    if (!input) {
      setError("please enter a server url or peer id");
      return;
    }

    // detect if this is a P2P address or HTTP URL
    const parsed = parsePeerAddress(input);

    if (parsed?.type === "p2p") {
      // P2P connection via midden
      setPeerAddr(parsed.peer_addr);
      setUrl(""); // clear URL display for P2P
      setIsLoading(true);
      setStep("testing");

      // create abort controller for cancellation
      const controller = new AbortController();
      setAbortController(controller);

      try {
        // first, try to get server info via P2P to verify connection
        const client = await getClientForRemote({
          peer_addr: parsed.peer_addr,
          transport_type: isTauriAvailable() ? "app" : "wasm",
        });

        // check if cancelled while initializing
        if (controller.signal.aborted) return;

        const infoResult = await client.app.serverInfo();

        // check if cancelled while fetching
        if (controller.signal.aborted) return;

        if (!infoResult.success || !infoResult.data) {
          // server is reachable but didn't return valid info
          // this might be a permission issue - offer registration
          const errorMsg =
            infoResult.success === false && "error" in infoResult
              ? formatErrorMessage(infoResult.error)
              : "server did not return valid info";

          setError(
            `connection succeeded but: ${errorMsg}. you may need to register with an invite code.`
          );
          // still move to auth step to offer registration
          setServerInfo(null);
          setStep("auth");
          return;
        }

        const info = infoResult.data;

        // save server info and show auth step for registration
        setServerInfo({
          server_id: info.server_id,
          name: info.name,
          description: info.description,
          version: info.version,
          image_url: info.image_url,
          requiresAuth: false, // P2P registration uses invite code only - no passkey needed
        });

        // move to auth step - P2P requires registration
        setStep("auth");
      } catch (err) {
        // ignore if cancelled
        if (controller.signal.aborted) return;

        console.error("failed to connect via P2P:", err);

        // provide more helpful error message
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes("timeout") || errMsg.includes("Timeout")) {
          setError("P2P connection timed out - peer may be offline or unreachable");
        } else if (errMsg.includes("not found") || errMsg.includes("NotFound")) {
          setError("P2P peer not found - check the peer ID and try again");
        } else {
          setError(`P2P connection failed: ${errMsg}`);
        }
        setStep("url");
      } finally {
        setIsLoading(false);
        setAbortController(null);
      }
      return;
    }

    // HTTP connection - existing logic
    let remoteUrl = input;

    // auto-prefix with scheme if not provided
    if (!remoteUrl.startsWith("http://") && !remoteUrl.startsWith("https://")) {
      const scheme = window.location.protocol; // http: or https:
      remoteUrl = `${scheme}//${remoteUrl}`;
    }

    // trim trailing slash
    remoteUrl = remoteUrl.replace(/\/+$/, "");
    setUrl(remoteUrl);

    // validate url format
    try {
      new URL(remoteUrl);
    } catch {
      setError("please enter a valid url (e.g. https://music.example.com)");
      return;
    }

    // check for duplicate url
    const existingRemotes = await getAllRemotes();
    const normalizedUrl = remoteUrl.replace(/\/$/, "");
    const duplicate = existingRemotes.find((r) => r.base_url === normalizedUrl);
    if (duplicate) {
      setError(
        `this server is already added as "${duplicate.name}". each server can only be added once.`
      );
      return;
    }

    setIsLoading(true);
    setStep("testing");

    // create abort controller for cancellation
    const controller = new AbortController();
    setAbortController(controller);

    try {
      // fetch server info from /api/hello (public endpoint)
      const helloResult = await getServerInfo(remoteUrl);

      // check if cancelled while waiting
      if (controller.signal.aborted) return;

      if (!helloResult.success || !helloResult.data) {
        throw new Error("failed to fetch server info");
      }

      const info = helloResult.data;

      // test connection using whoami endpoint to check auth status
      const whoamiResult = await whoami(remoteUrl);

      // check if cancelled while waiting
      if (controller.signal.aborted) return;

      if (whoamiResult.success) {
        // already authenticated, complete setup immediately
        setServerInfo({
          server_id: info.server_id,
          name: info.name,
          description: info.description,
          version: info.version,
          image_url: info.image_url,
          requiresAuth: true,
        });
        await completeSetup();
        return;
      }

      // not authenticated yet - show server info and move to auth step
      setServerInfo({
        server_id: info.server_id,
        name: info.name,
        description: info.description,
        version: info.version,
        image_url: info.image_url,
        requiresAuth: true,
      });

      // move to auth step
      setStep("auth");
    } catch (err) {
      // ignore if cancelled
      if (controller.signal.aborted) return;

      console.error("failed to connect to remote:", err);
      setError(
        err instanceof Error
          ? `connection failed: ${err.message}`
          : "failed to connect to remote server"
      );
      setStep("url");
    } finally {
      setIsLoading(false);
      setAbortController(null);
    }
  };

  // step 2/3: handle authentication
  const handleAuth = async (data: {
    username: string;
    inviteCode?: string;
    mode: "login" | "register";
  }) => {
    setError(null);
    setIsLoading(true);

    try {
      const baseUrl = url().trim();
      const currentPeerAddr = peerAddr();

      debug("auth", `starting ${data.mode} for username:`, data.username);

      // P2P auth uses invite code redemption directly
      if (currentPeerAddr) {
        if (data.mode === "login") {
          // P2P login not yet supported - need session management
          throw new Error(
            "login not yet supported for P2P remotes - please register with an invite code"
          );
        }

        if (!data.inviteCode) {
          throw new Error("invite code required for P2P registration");
        }

        // get P2P client and redeem invite
        const client = await getClientForRemote({
          peer_addr: currentPeerAddr,
          transport_type: isTauriAvailable() ? "app" : "wasm",
        });

        debug("auth", "redeeming invite code via P2P...");
        const redeemResult = await client.auth.redeemInvite({
          invite_code: data.inviteCode,
          username: data.username,
          node_id: null, // server extracts peer node_id from connection
        });

        if (!redeemResult.success) {
          const errMsg =
            "error" in redeemResult
              ? formatErrorMessage(redeemResult.error)
              : "invite code redemption failed";
          throw new Error(errMsg);
        }

        debug("auth", "P2P invite code redemption successful");
      } else {
        // HTTP auth uses WebAuthn
        const result = await authenticate(baseUrl, data);

        if (!result.success) {
          throw new Error(result.error ?? "authentication failed");
        }
      }

      debug("auth", `${data.mode} complete!`);

      // authentication successful, complete setup
      await completeSetup();
    } catch (err) {
      console.error("authentication failed:", err);
      setError(err instanceof Error ? err.message : "authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  // final step: save remote config
  const completeSetup = async () => {
    try {
      // createRemote will fetch server name from /api/hello
      const remoteUrl = url();
      const currentPeerAddr = peerAddr();

      const remote = await createRemote({
        base_url: remoteUrl || undefined,
        peer_addr: currentPeerAddr || undefined,
      });

      setStep("complete");

      // auto-close after short delay
      setTimeout(() => {
        handleClose();
        props.onSuccess?.(remote);
      }, 1500);
    } catch (err) {
      console.error("failed to save remote:", err);
      setError(err instanceof Error ? err.message : "failed to save remote");
      setStep("url");
    }
  };

  const handleClose = () => {
    // allow close during testing step (abort the connection), but not during auth
    if (isLoading() && step() !== "testing") return;

    // abort any in-progress connection test
    const controller = abortController();
    if (controller) {
      controller.abort();
      setAbortController(null);
    }

    setStep("url");
    setUrl("");
    setPeerAddr(null);
    setError(null);
    setServerInfo(null);
    setOriginHint(null);
    setIsLoading(false);
    props.onClose();
  };

  const canGoBack = () => {
    return step() === "auth" || (step() === "testing" && isLoading());
  };

  const handleBack = () => {
    if (step() === "auth") {
      setStep("url");
      setError(null);
    } else if (step() === "testing") {
      // cancel in-progress connection test
      const controller = abortController();
      if (controller) {
        controller.abort();
        setAbortController(null);
      }
      setStep("url");
      setIsLoading(false);
      setError(null);
    }
  };

  return (
    <Show when={props.isOpen}>
      {/* backdrop */}
      <div
        class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        onClick={handleClose}
      >
        {/* modal */}
        <div
          class="bg-[var(--color-bg-primary)] rounded-lg shadow-xl max-w-md w-full border border-[var(--color-border-default)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* header */}
          <div class="flex items-center justify-between p-6 border-b border-[var(--color-border-default)]">
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
              disabled={isLoading()}
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
          <div class="p-6">
            <Switch>
              {/* step 1: enter url */}
              <Match when={step() === "url"}>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleTestConnection();
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
                    <input
                      id="remote-url"
                      type="text"
                      value={url()}
                      onInput={(e) => setUrl(e.currentTarget.value)}
                      placeholder="https://music.example.com or node_id"
                      class="w-full px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-md text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)] focus:border-transparent font-mono text-sm"
                      disabled={isLoading()}
                    />
                    <p class="mt-1 text-xs text-[var(--color-text-tertiary)]">
                      enter a URL for HTTP, or paste a 64-char node_id for P2P
                    </p>
                  </div>

                  <Show when={error()}>
                    <div class="p-3 bg-[var(--color-status-error)]/10 border border-[var(--color-status-error)] rounded-md">
                      <p class="text-sm text-[var(--color-status-error)]">{error()}</p>
                    </div>
                  </Show>

                  <Button type="submit" variant="primary" disabled={isLoading()} class="w-full">
                    test connection
                  </Button>

                  {/* hint: use current origin if it's a valid server */}
                  <Show when={originHint()}>
                    <div class="text-center pt-2 border-t border-[var(--color-border-default)]">
                      <button
                        type="button"
                        class="text-sm text-[var(--color-accent-primary)] hover:underline"
                        onClick={() => {
                          setUrl(originHint()!);
                          handleTestConnection();
                        }}
                        disabled={isLoading()}
                      >
                        use {originHint()}
                      </button>
                    </div>
                  </Show>
                </form>
              </Match>

              {/* step 2: testing connection */}
              <Match when={step() === "testing"}>
                <div class="flex flex-col items-center justify-center py-8 space-y-4">
                  <div class="w-12 h-12 border-4 border-[var(--color-accent-primary)] border-t-transparent rounded-full animate-spin" />
                  <p class="text-sm text-[var(--color-text-secondary)]">
                    {peerAddr()
                      ? `connecting via P2P to ${peerAddr()!.slice(0, 16)}...`
                      : `connecting to ${url()}...`}
                  </p>
                </div>
              </Match>

              {/* step 3: authenticate */}
              <Match when={step() === "auth"}>
                <div class="space-y-4">
                  {/* server info display - show if available */}
                  <Show when={serverInfo()}>
                    <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-md">
                      <div class="flex items-start gap-3">
                        <MediaImage
                          imageUrl={
                            serverInfo()?.image_url && !peerAddr()
                              ? `${url()}${serverInfo()?.image_url}`
                              : null
                          }
                          alt={serverInfo()?.name ?? "Server"}
                          class="w-12 h-12 rounded object-cover"
                        />
                        <div class="flex-1 min-w-0">
                          <p class="text-sm font-medium text-[var(--color-text-primary)]">
                            {serverInfo()?.name}
                          </p>
                          <Show when={serverInfo()?.description}>
                            <p class="text-xs text-[var(--color-text-secondary)] mt-0.5">
                              {serverInfo()?.description}
                            </p>
                          </Show>
                          <p class="text-xs text-[var(--color-text-tertiary)] mt-1">
                            {peerAddr() && <span>P2P • </span>}
                            version {serverInfo()?.version} • {serverInfo()?.server_id}
                          </p>
                        </div>
                      </div>
                    </div>
                  </Show>

                  {/* P2P-specific info when no server info */}
                  <Show when={peerAddr() && !serverInfo()}>
                    <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-md">
                      <p class="text-sm text-[var(--color-text-secondary)]">
                        P2P peer: <code class="text-xs">{peerAddr()!.slice(0, 16)}...</code>
                      </p>
                      <p class="text-xs text-[var(--color-text-tertiary)] mt-2">
                        register with an invite code to connect
                      </p>
                    </div>
                  </Show>

                  <AuthForm
                    initialMode={peerAddr() ? "register" : "login"}
                    onSubmit={handleAuth}
                    loading={isLoading()}
                    error={error() || undefined}
                    showModeToggle={!peerAddr()} // hide mode toggle for P2P (login not supported)
                  />
                </div>
              </Match>

              {/* step 4: complete */}
              <Match when={step() === "complete"}>
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
                      {peerAddr()
                        ? `P2P peer ${peerAddr()!.slice(0, 16)}... is ready`
                        : `${url()} is ready to use`}
                    </p>
                  </div>
                </div>
              </Match>
            </Switch>
          </div>
        </div>
      </div>
    </Show>
  );
}
