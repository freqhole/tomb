// add remote modal - multi-step wizard for adding a new remote server
// steps: 1) enter url, 2) test connection, 3) authenticate, 4) complete
import * as apiClient from "freqhole-api-client";
import { createSignal, Match, Show, Switch } from "solid-js";
import {
  createRemote,
  getAllRemotes,
} from "../../music/services/remotes/remoteManager";
import { AuthForm } from "../auth/AuthForm";
import { Button } from "../buttons/Button";

export interface AddRemoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (remote: {
    remote_id: string;
    name: string;
    base_url: string;
  }) => void;
}

type Step = "url" | "testing" | "auth" | "complete";

export function AddRemoteModal(props: AddRemoteModalProps) {
  const [step, setStep] = createSignal<Step>("url");
  const [url, setUrl] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [serverInfo, setServerInfo] = createSignal<{
    name: string;
    version?: string;
    requiresAuth: boolean;
  } | null>(null);

  // step 1: collect url and test connection
  const handleTestConnection = async () => {
    setError(null);

    let remoteUrl = url().trim();

    if (!remoteUrl) {
      setError("please enter a server url");
      return;
    }

    // auto-prefix with scheme if not provided
    if (!remoteUrl.startsWith("http://") && !remoteUrl.startsWith("https://")) {
      const scheme = window.location.protocol; // http: or https:
      remoteUrl = `${scheme}//${remoteUrl}`;
      setUrl(remoteUrl); // update the input field
    }

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
        `this server is already added as "${duplicate.name}". each server can only be added once.`,
      );
      return;
    }

    setIsLoading(true);
    setStep("testing");

    try {
      // test connection using whoami endpoint
      const whoamiResult = await apiClient.auth.whoami(remoteUrl);

      if (whoamiResult.success) {
        // already authenticated, complete setup immediately
        setServerInfo({
          name: whoamiResult.data.username || "remote server",
          version: undefined,
          requiresAuth: true,
        });
        await completeSetup();
        return;
      }

      // not authenticated yet - need to auth
      // try health check to verify server is reachable
      const healthResult = await apiClient.app.healthCheck(remoteUrl);

      if (!healthResult.success) {
        throw new Error("server is not responding");
      }

      setServerInfo({
        name: "remote server",
        version: undefined,
        requiresAuth: true,
      });

      // move to auth step
      setStep("auth");
    } catch (err) {
      console.error("failed to connect to remote:", err);
      setError(
        err instanceof Error
          ? `connection failed: ${err.message}`
          : "failed to connect to remote server",
      );
      setStep("url");
    } finally {
      setIsLoading(false);
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

      if (data.mode === "register") {
        // registration flow with webauthn
        if (!data.inviteCode) {
          throw new Error("invite code required for registration");
        }

        console.log("starting registration for username:", data.username);

        // step 1: start registration with invite code
        console.log("starting webauthn registration...");
        const startResult = await apiClient.auth.registerStart(baseUrl, {
          username: data.username,
          invite_code: data.inviteCode, // pass invite code to register_start
        });

        if (!startResult.success) {
          console.error("register start failed:", startResult);
          throw new Error("failed to start registration");
        }
        console.log("register start response:", startResult.data);

        // step 2: create webauthn credential
        console.log("requesting credential creation from browser...");
        const credentialOptions = apiClient.webauthn.prepareRegistrationOptions(
          startResult.data,
        );
        const credential = (await navigator.credentials.create(
          credentialOptions,
        )) as PublicKeyCredential;

        if (!credential) {
          throw new Error("failed to create credential");
        }
        console.log("credential created:", credential);
        console.log("credential.response:", credential.response);
        console.log(
          "attestationObject:",
          (credential.response as AuthenticatorAttestationResponse)
            .attestationObject,
        );
        console.log("clientDataJSON:", credential.response.clientDataJSON);

        // step 3: finish registration
        console.log("finishing registration...");
        const serializedCredential =
          apiClient.webauthn.serializeRegistrationCredential(credential);
        console.log("serialized credential:", serializedCredential);
        const finishResult = await apiClient.auth.registerFinish(
          baseUrl,
          serializedCredential,
        );

        if (!finishResult.success) {
          console.error("register finish failed:", finishResult);
          throw new Error("failed to complete registration");
        }
        console.log("registration complete!");
      } else {
        // login flow with webauthn
        console.log("starting login for username:", data.username);

        // step 1: start login
        console.log("starting webauthn login...");
        const startResult = await apiClient.auth.loginStart(baseUrl, {
          username: data.username,
        });

        if (!startResult.success) {
          console.error("login start failed:", startResult);
          throw new Error("failed to start login");
        }
        console.log("login start response:", startResult.data);

        // step 2: get webauthn credential
        console.log("requesting credential from browser...");
        const credentialOptions =
          apiClient.webauthn.prepareAuthenticationOptions(startResult.data);
        const credential = (await navigator.credentials.get(
          credentialOptions,
        )) as PublicKeyCredential;

        if (!credential) {
          throw new Error("failed to get credential");
        }
        console.log("credential retrieved:", credential);
        console.log("credential.response:", credential.response);
        console.log(
          "authenticatorData:",
          (credential.response as AuthenticatorAssertionResponse)
            .authenticatorData,
        );
        console.log("clientDataJSON:", credential.response.clientDataJSON);
        console.log(
          "signature:",
          (credential.response as AuthenticatorAssertionResponse).signature,
        );

        // step 3: finish login
        console.log("finishing login...");
        const serializedCredential =
          apiClient.webauthn.serializeAuthenticationCredential(credential);
        console.log("serialized credential:", serializedCredential);
        const finishResult = await apiClient.auth.loginFinish(
          baseUrl,
          serializedCredential,
        );

        if (!finishResult.success) {
          console.error("login finish failed:", finishResult);
          throw new Error("failed to complete login");
        }
        console.log("login complete!");
      }

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
      // use url as the name
      const remoteUrl = url();
      const remote = await createRemote({
        name: remoteUrl,
        base_url: remoteUrl,
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
    if (isLoading()) return;
    setStep("url");
    setUrl("");
    setError(null);
    setServerInfo(null);
    props.onClose();
  };

  const canGoBack = () => {
    return !isLoading() && (step() === "auth" || step() === "url");
  };

  const handleBack = () => {
    if (step() === "auth") {
      setStep("url");
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
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                </button>
              </Show>
              <h2 class="text-xl font-bold text-[var(--color-text-primary)]">
                add remote server
              </h2>
            </div>
            <button
              type="button"
              class="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              onClick={handleClose}
              disabled={isLoading()}
            >
              <svg
                class="w-6 h-6"
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
                      server url
                    </label>
                    <input
                      id="remote-url"
                      type="url"
                      value={url()}
                      onInput={(e) => setUrl(e.currentTarget.value)}
                      placeholder="https://music.example.com"
                      class="w-full px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-md text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)] focus:border-transparent"
                      disabled={isLoading()}
                    />
                    <p class="mt-1 text-xs text-[var(--color-text-tertiary)]">
                      the full url of your remote music server
                    </p>
                  </div>

                  <Show when={error()}>
                    <div class="p-3 bg-[var(--color-status-error)]/10 border border-[var(--color-status-error)] rounded-md">
                      <p class="text-sm text-[var(--color-status-error)]">
                        {error()}
                      </p>
                    </div>
                  </Show>

                  <Button
                    type="submit"
                    variant="primary"
                    disabled={isLoading()}
                    class="w-full"
                  >
                    test connection
                  </Button>
                </form>
              </Match>

              {/* step 2: testing connection */}
              <Match when={step() === "testing"}>
                <div class="flex flex-col items-center justify-center py-8 space-y-4">
                  <div class="w-12 h-12 border-4 border-[var(--color-accent-primary)] border-t-transparent rounded-full animate-spin" />
                  <p class="text-sm text-[var(--color-text-secondary)]">
                    connecting to {url()}...
                  </p>
                </div>
              </Match>

              {/* step 3: authenticate */}
              <Match when={step() === "auth"}>
                <div class="space-y-4">
                  <div class="p-3 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-md">
                    <p class="text-sm text-[var(--color-text-secondary)]">
                      connected to <strong>{serverInfo()?.name}</strong>
                    </p>
                    <Show when={serverInfo()?.version}>
                      <p class="text-xs text-[var(--color-text-tertiary)] mt-1">
                        version {serverInfo()?.version}
                      </p>
                    </Show>
                  </div>

                  <AuthForm
                    initialMode="login"
                    onSubmit={handleAuth}
                    loading={isLoading()}
                    error={error() || undefined}
                    showModeToggle={true}
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
                      {url()} is ready to use
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
