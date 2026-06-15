// link device view
//
// handles the ?link=<base64> flow for linking an external device (e.g. tauri/charnel app)
// to a freqhole account via passkey authentication in the browser.
//
// the charnel app generates a url like:
//   https://spume.freqhole.net/?link=<base64(json)>
//
// the base64 payload contains:
//   { peer_addr: string, name: string, description: string | null }
//
// flow:
//   1. user opens url in a browser where they have (or can register) a passkey
//   2. this view decodes the payload, shows remote context, prompts for passkey
//   3. on success, calls link-node to add the charnel node_id as a trusted peer
//   4. shows a success message; the charnel app polls whoami until it sees itself

import { createSignal, Show } from "solid-js";
import {
  registerWithWebauthnP2P,
  loginWithWebauthnP2P,
} from "../../app/services/remotes/authService";
import { getClientForRemote, getLocalNodeId } from "../../app/api/client";
import { debug } from "../../utils/logger";

interface LinkPayload {
  peer_addr: string;
  name: string;
  description: string | null;
  // optional: the node_id of the device to link (the charnel app's node_id)
  // if absent, only the browser's node_id is linked (standard passkey login)
  link_node_id?: string;
}

function decodeLinkPayload(raw: string): LinkPayload | null {
  try {
    const json = atob(decodeURIComponent(raw));
    const obj = JSON.parse(json);
    if (typeof obj.peer_addr !== "string" || typeof obj.name !== "string") return null;
    return obj as LinkPayload;
  } catch {
    return null;
  }
}

type Mode = "login" | "register";
type Stage = "form" | "busy" | "success" | "error";

export function LinkDeviceView() {
  // read ?link= from current URL
  const raw = new URLSearchParams(window.location.search).get("link") ?? "";
  const payload = decodeLinkPayload(raw);

  const [mode, setMode] = createSignal<Mode>("login");
  const [username, setUsername] = createSignal("");
  const [inviteCode, setInviteCode] = createSignal("");
  const [stage, setStage] = createSignal<Stage>(payload ? "form" : "error");
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
  const [linkedNodeId, setLinkedNodeId] = createSignal<string | null>(null);

  async function handleSubmit() {
    if (!payload) return;

    const user = username().trim();
    const code = inviteCode().trim();

    if (!user) {
      setErrorMsg("username is required");
      return;
    }
    if (mode() === "register" && !code) {
      setErrorMsg("invite code is required");
      return;
    }

    setStage("busy");
    setErrorMsg(null);

    try {
      // step 1: authenticate this browser session via passkey
      const authResult =
        mode() === "register"
          ? await registerWithWebauthnP2P(payload.peer_addr, user, code)
          : await loginWithWebauthnP2P(payload.peer_addr, user);

      if (!authResult.success) {
        setStage("error");
        setErrorMsg(authResult.error ?? "passkey authentication failed");
        return;
      }

      debug("link-device", "passkey auth succeeded:", authResult);

      // step 2: if the payload includes a link_node_id, link it to the authenticated user.
      // this is the charnel/tauri app's own node_id.
      if (payload.link_node_id) {
        const client = await getClientForRemote({
          transport: "wasm" as const,
          peer_addr: payload.peer_addr,
        });
        const linkResult = await client.auth.linkNode({ node_id: payload.link_node_id });
        if (!linkResult.success) {
          // non-fatal: browser session is still linked. log and continue.
          debug("link-device", "link_node_id step failed (non-fatal):", linkResult);
        } else {
          setLinkedNodeId(payload.link_node_id);
          debug("link-device", "linked external node_id:", payload.link_node_id);
        }
      }

      setStage("success");
    } catch (e) {
      debug("link-device", "error:", e);
      setStage("error");
      setErrorMsg(e instanceof Error ? e.message : "authentication failed");
    }
  }

  return (
    <div class="min-h-screen bg-[var(--color-bg-primary)] flex items-center justify-center p-4">
      <div class="w-full max-w-sm space-y-6">
        {/* header */}
        <div class="text-center">
          <h1 class="text-xl font-semibold text-[var(--color-text-primary)]">link device</h1>
          <p class="text-sm text-[var(--color-text-muted)] mt-1">
            sign in to link this browser session
          </p>
        </div>

        {/* invalid link */}
        <Show when={!payload}>
          <div class="p-4 bg-[var(--color-status-error)]/10 border border-[var(--color-status-error)] rounded-lg text-center">
            <p class="text-sm text-[var(--color-status-error)]">invalid or missing link payload</p>
            <p class="text-xs text-[var(--color-text-muted)] mt-1">
              use the link generated from your freqhole app
            </p>
          </div>
        </Show>

        {/* remote context */}
        <Show when={payload}>
          <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg">
            <p class="text-sm font-medium text-[var(--color-text-primary)]">{payload!.name}</p>
            <Show when={payload!.description}>
              <p class="text-xs text-[var(--color-text-secondary)] mt-0.5">
                {payload!.description}
              </p>
            </Show>
            <p class="text-xs text-[var(--color-text-muted)] mt-2 font-mono">
              {payload!.peer_addr.slice(0, 24)}...
            </p>
            <Show when={payload!.link_node_id}>
              <p class="text-xs text-[var(--color-text-muted)] mt-1">
                device to link:{" "}
                <span class="font-mono">{payload!.link_node_id!.slice(0, 16)}...</span>
              </p>
            </Show>
          </div>
        </Show>

        {/* form */}
        <Show when={payload && stage() === "form"}>
          <div class="space-y-4">
            {/* mode toggle */}
            <div class="flex rounded-lg border border-[var(--color-border-default)] overflow-hidden">
              <button
                class="flex-1 py-2 text-sm font-medium transition-colors"
                classList={{
                  "bg-[var(--color-accent-500)] text-white": mode() === "login",
                  "bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]":
                    mode() !== "login",
                }}
                onClick={() => setMode("login")}
              >
                sign in with passkey
              </button>
              <button
                class="flex-1 py-2 text-sm font-medium transition-colors border-l border-[var(--color-border-default)]"
                classList={{
                  "bg-[var(--color-accent-500)] text-white": mode() === "register",
                  "bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]":
                    mode() !== "register",
                }}
                onClick={() => setMode("register")}
              >
                register new passkey
              </button>
            </div>

            <Show when={errorMsg()}>
              <p class="text-sm text-[var(--color-status-error)]">{errorMsg()}</p>
            </Show>

            <div>
              <label class="block text-xs font-medium text-[var(--color-text-primary)] mb-1">
                username
              </label>
              <input
                type="text"
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
                placeholder="your username on this server"
                class="w-full px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)]"
              />
            </div>

            <Show when={mode() === "register"}>
              <div>
                <label class="block text-xs font-medium text-[var(--color-text-primary)] mb-1">
                  invite code
                </label>
                <input
                  type="text"
                  value={inviteCode()}
                  onInput={(e) => setInviteCode(e.currentTarget.value)}
                  placeholder="account-link code from the server admin"
                  class="w-full px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)]"
                />
              </div>
            </Show>

            <button
              class="w-full py-2.5 text-sm font-medium rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] text-white transition-colors"
              onClick={() => void handleSubmit()}
            >
              {mode() === "register" ? "register passkey & link" : "sign in & link"}
            </button>
          </div>
        </Show>

        {/* busy */}
        <Show when={stage() === "busy"}>
          <div class="flex flex-col items-center gap-3 py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-2 border-[var(--color-accent-500)] border-t-transparent" />
            <p class="text-sm text-[var(--color-text-secondary)]">
              {mode() === "register" ? "registering passkey..." : "authenticating..."}
            </p>
          </div>
        </Show>

        {/* success */}
        <Show when={stage() === "success"}>
          <div class="p-6 bg-[var(--color-status-success)]/10 border border-[var(--color-status-success)] rounded-lg text-center space-y-2">
            <p class="text-lg font-semibold text-[var(--color-status-success)]">linked!</p>
            <p class="text-sm text-[var(--color-text-secondary)]">
              this browser session is now linked to your account on{" "}
              <span class="font-medium">{payload!.name}</span>.
            </p>
            <Show when={linkedNodeId()}>
              <p class="text-xs text-[var(--color-text-muted)]">
                device <span class="font-mono">{linkedNodeId()!.slice(0, 16)}...</span> was also
                linked. you can close this tab — your app should now have access.
              </p>
            </Show>
            <Show when={!linkedNodeId()}>
              <p class="text-xs text-[var(--color-text-muted)]">
                your browser node id{" "}
                <Show when={getLocalNodeId()}>
                  {(id) => <span class="font-mono">{id().slice(0, 16)}...</span>}
                </Show>{" "}
                has been linked. you can close this tab.
              </p>
            </Show>
          </div>
        </Show>

        {/* error */}
        <Show when={stage() === "error" && payload}>
          <div class="space-y-3">
            <div class="p-4 bg-[var(--color-status-error)]/10 border border-[var(--color-status-error)] rounded-lg">
              <p class="text-sm text-[var(--color-status-error)]">
                {errorMsg() ?? "authentication failed"}
              </p>
            </div>
            <button
              class="w-full py-2 text-sm font-medium rounded-lg border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
              onClick={() => {
                setStage("form");
                setErrorMsg(null);
              }}
            >
              try again
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
