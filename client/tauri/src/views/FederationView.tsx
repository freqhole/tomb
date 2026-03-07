import { createSignal, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

interface FederationConfigStatus {
  enabled: boolean;
  haruspex_url: string;
  auto_create_users: boolean;
  default_role: string;
}

interface FederationCredentialsStatus {
  stored: boolean;
  path: string;
  email: string | null;
  haruspex_user_id: string | null;
  created_at: string | null;
  last_refreshed_at: string | null;
  verified: boolean | null;
  verification_error: string | null;
}

interface FederationIdentityStatus {
  keypair_exists: boolean;
  keypair_path: string;
  node_id: string | null;
}

interface FederationStatus {
  config: FederationConfigStatus | null;
  credentials: FederationCredentialsStatus;
  identity: FederationIdentityStatus;
}

interface FederationSetupResult {
  haruspex_user_id: string;
  email: string;
  credentials_path: string;
}

interface FederationSyncResult {
  groups_found: number;
  members_found: number;
  users_created: number;
  users_updated: number;
  users_skipped: number;
  peer_nodes_registered: number;
  errors: string[];
}

interface AllowPeerResult {
  user_id: string;
  username: string;
  node_id: string;
  created_user: boolean;
}

export default function FederationView() {
  const [status, setStatus] = createSignal<FederationStatus | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [success, setSuccess] = createSignal("");

  // setup form
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [setupLoading, setSetupLoading] = createSignal(false);
  const [setupError, setSetupError] = createSignal("");

  // sync
  const [syncLoading, setSyncLoading] = createSignal(false);
  const [syncResult, setSyncResult] = createSignal<FederationSyncResult | null>(
    null,
  );

  // logout confirmation
  const [confirmLogout, setConfirmLogout] = createSignal(false);

  // toggle
  const [toggling, setToggling] = createSignal(false);

  // allow peer
  const [peerNodeId, setPeerNodeId] = createSignal("");
  const [peerUsername, setPeerUsername] = createSignal("");
  const [peerRole, setPeerRole] = createSignal("viewer");
  const [allowPeerLoading, setAllowPeerLoading] = createSignal(false);
  const [allowPeerResult, setAllowPeerResult] =
    createSignal<AllowPeerResult | null>(null);

  onMount(async () => {
    await loadStatus();
  });

  async function loadStatus() {
    setLoading(true);
    setError("");
    try {
      const result = await invoke<FederationStatus>("get_federation_status");
      setStatus(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSetup(e: Event) {
    e.preventDefault();
    setSetupLoading(true);
    setError("");
    setSetupError("");
    setSuccess("");

    try {
      const result = await invoke<FederationSetupResult>("federation_setup", {
        email: email(),
        password: password(),
      });
      setSuccess(`setup complete! logged in as ${result.email}`);
      setPassword(""); // clear password
      await loadStatus();
    } catch (e) {
      // extract just the error message from the JSON if possible
      const errStr = String(e);
      const match = errStr.match(/"msg":"([^"]+)"/);
      setSetupError(match ? match[1] : errStr);
    } finally {
      setSetupLoading(false);
    }
  }

  async function handleSync() {
    setSyncLoading(true);
    setError("");
    setSuccess("");
    setSyncResult(null);

    try {
      const result = await invoke<FederationSyncResult>("federation_sync");
      setSyncResult(result);
      setSuccess(
        `sync complete: ${result.users_updated} users synced, ${result.peer_nodes_registered} peers registered`,
      );
      await loadStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setSyncLoading(false);
    }
  }

  async function handleLogout() {
    setError("");
    setSuccess("");
    setConfirmLogout(false);

    try {
      await invoke("federation_logout");
      setSuccess("logged out");
      await loadStatus();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleToggle() {
    setToggling(true);
    setError("");
    setSuccess("");

    try {
      const newValue = await invoke<boolean>("toggle_federation_enabled");
      // update local state to reflect the change
      const current = status();
      if (current) {
        setStatus({
          ...current,
          config: current.config
            ? { ...current.config, enabled: newValue }
            : {
                enabled: newValue,
                haruspex_url: "",
                auto_create_users: false,
                default_role: "guest",
              },
        });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setToggling(false);
    }
  }

  async function handleAllowPeer(e: Event) {
    e.preventDefault();
    setAllowPeerLoading(true);
    setError("");
    setSuccess("");
    setAllowPeerResult(null);

    try {
      const result = await invoke<AllowPeerResult>("allow_peer", {
        nodeId: peerNodeId(),
        username: peerUsername() || undefined,
        role: peerRole(),
      });
      setAllowPeerResult(result);
      setSuccess(
        result.created_user
          ? `peer allowed: created user "${result.username}"`
          : `peer allowed: linked to existing user "${result.username}"`,
      );
      // clear form
      setPeerNodeId("");
      setPeerUsername("");
    } catch (e) {
      setError(String(e));
    } finally {
      setAllowPeerLoading(false);
    }
  }

  const isConfigured = () => status()?.config?.enabled ?? false;
  const hasCredentials = () => status()?.credentials.stored ?? false;
  const isVerified = () => status()?.credentials.verified === true;
  const hasKeypair = () => status()?.identity.keypair_exists ?? false;

  return (
    <div class="view-container">
      <h1>federation</h1>

      <Show when={error()}>
        <div class="error-banner">{error()}</div>
      </Show>

      <Show when={success()}>
        <div class="success-banner">{success()}</div>
      </Show>

      <Show when={loading()}>
        <div class="loading">loading federation status...</div>
      </Show>

      <Show when={!loading() && status()}>
        {/* configuration status */}
        <section class="status-section">
          <h2>configuration</h2>
          <Show
            when={isConfigured()}
            fallback={
              <div class="status-content">
                <div class="status-message warning">federation is disabled</div>
                <button
                  class="small"
                  onClick={handleToggle}
                  disabled={toggling()}
                >
                  {toggling() ? "enabling..." : "enable federation"}
                </button>
              </div>
            }
          >
            <div class="status-grid">
              <div class="status-item">
                <span class="label">status</span>
                <span class="value ok">enabled</span>
              </div>
              <div class="status-item">
                <span class="label">haruspex url</span>
                <span class="value mono">{status()?.config?.haruspex_url}</span>
              </div>
              <div class="status-item">
                <span class="label">auto create users</span>
                <span class="value">
                  {status()?.config?.auto_create_users ? "yes" : "no"}
                </span>
              </div>
              <div class="status-item">
                <span class="label">default role</span>
                <span class="value">{status()?.config?.default_role}</span>
              </div>
            </div>
            <div class="section-actions">
              <button
                class="secondary small"
                onClick={handleToggle}
                disabled={toggling()}
              >
                {toggling() ? "disabling..." : "disable federation"}
              </button>
            </div>
          </Show>
        </section>

        {/* identity status - only show when federation is enabled */}
        <Show when={isConfigured()}>
          <section class="status-section">
            <h2>identity</h2>
            <div class="status-grid">
              <div class="status-item">
                <span class="label">keypair</span>
                <span class={`value ${hasKeypair() ? "ok" : "warning"}`}>
                  {hasKeypair() ? "exists" : "not generated"}
                </span>
              </div>
              <Show when={hasKeypair()}>
                <div class="status-item full-width">
                  <span class="label">node id</span>
                  <span class="value mono small">
                    {status()?.identity.node_id}
                  </span>
                </div>
              </Show>
              <div class="status-item full-width">
                <span class="label">keypair path</span>
                <span class="value mono small">
                  {status()?.identity.keypair_path}
                </span>
              </div>
            </div>
          </section>

          {/* allow peer - manual node_id registration */}
          <section class="status-section">
            <h2>allow peer</h2>
            <p class="help-text">
              manually allow a P2P peer by their node_id. creates a user if
              needed.
            </p>
            <form onSubmit={handleAllowPeer}>
              <div class="form-group">
                <label for="peer-node-id">node_id</label>
                <input
                  id="peer-node-id"
                  type="text"
                  value={peerNodeId()}
                  onInput={(e) => setPeerNodeId(e.currentTarget.value)}
                  placeholder="64-character hex node id"
                  pattern="[0-9a-fA-F]{64}"
                  required
                />
              </div>
              <div class="form-group">
                <label for="peer-username">username (optional)</label>
                <input
                  id="peer-username"
                  type="text"
                  value={peerUsername()}
                  onInput={(e) => setPeerUsername(e.currentTarget.value)}
                  placeholder="auto-generated if empty"
                />
              </div>
              <div class="form-group">
                <label for="peer-role">role</label>
                <select
                  id="peer-role"
                  value={peerRole()}
                  onChange={(e) => setPeerRole(e.currentTarget.value)}
                >
                  <option value="viewer">viewer (read-only)</option>
                  <option value="member">member (can upload)</option>
                  <option value="admin">admin (full access)</option>
                </select>
              </div>
              <button type="submit" disabled={allowPeerLoading()}>
                {allowPeerLoading() ? "allowing..." : "allow peer"}
              </button>
            </form>
            <Show when={allowPeerResult()}>
              <div class="sync-result" style="margin-top: 1rem">
                <div class="stat">
                  <span class="label">user</span>
                  <span class="num">{allowPeerResult()?.username}</span>
                </div>
                <div class="stat">
                  <span class="label">
                    {allowPeerResult()?.created_user ? "created" : "linked"}
                  </span>
                </div>
              </div>
            </Show>
          </section>

          {/* credentials status with sign-in form */}
          <section class="status-section">
            <h2>haruspex credentials</h2>
            <Show
              when={hasCredentials()}
              fallback={
                <div class="credentials-setup">
                  <div class="status-message" style="margin-bottom: 1rem">
                    no credentials stored. sign in to connect to haruspex.
                  </div>
                  <form onSubmit={handleSetup}>
                    <div class="form-group">
                      <label for="email">email</label>
                      <input
                        id="email"
                        type="email"
                        value={email()}
                        onInput={(e) => setEmail(e.currentTarget.value)}
                        placeholder="your@email.com"
                        required
                      />
                    </div>
                    <div class="form-group">
                      <label for="password">password</label>
                      <input
                        id="password"
                        type="password"
                        value={password()}
                        onInput={(e) => setPassword(e.currentTarget.value)}
                        placeholder="password"
                        required
                      />
                    </div>
                    <button type="submit" disabled={setupLoading()}>
                      {setupLoading() ? "signing in..." : "sign in"}
                    </button>
                    <Show when={setupError()}>
                      <div class="form-error">{setupError()}</div>
                    </Show>
                  </form>
                </div>
              }
            >
              <div class="status-grid">
                <div class="status-item">
                  <span class="label">status</span>
                  <span
                    class={`value ${isVerified() ? "ok" : status()?.credentials.verified === false ? "error" : "warning"}`}
                  >
                    {isVerified()
                      ? "verified"
                      : status()?.credentials.verified === false
                        ? "invalid"
                        : "not verified"}
                  </span>
                </div>
                <div class="status-item">
                  <span class="label">email</span>
                  <span class="value">{status()?.credentials.email}</span>
                </div>
                <Show when={status()?.credentials.verification_error}>
                  <div class="status-item full-width">
                    <span class="label">error</span>
                    <span class="value error">
                      {status()?.credentials.verification_error}
                    </span>
                  </div>
                </Show>
              </div>

              {/* show sign-in form if credentials invalid */}
              <Show when={!isVerified()}>
                <div class="credentials-setup" style="margin-top: 1rem">
                  <form onSubmit={handleSetup}>
                    <div class="form-group">
                      <label for="email">email</label>
                      <input
                        id="email"
                        type="email"
                        value={email()}
                        onInput={(e) => setEmail(e.currentTarget.value)}
                        placeholder="your@email.com"
                        required
                      />
                    </div>
                    <div class="form-group">
                      <label for="password">password</label>
                      <input
                        id="password"
                        type="password"
                        value={password()}
                        onInput={(e) => setPassword(e.currentTarget.value)}
                        placeholder="password"
                        required
                      />
                    </div>
                    <button type="submit" disabled={setupLoading()}>
                      {setupLoading() ? "signing in..." : "sign in"}
                    </button>
                    <Show when={setupError()}>
                      <div class="form-error">{setupError()}</div>
                    </Show>
                  </form>
                </div>
              </Show>
            </Show>
          </section>

          {/* sync controls - show when credentials are valid */}
          <Show when={isVerified()}>
            <section class="status-section">
              <h2>sync</h2>
              <p class="help-text">
                sync group members from haruspex to create freqhole users and
                register peer nodes.
              </p>
              <div class="button-row">
                <button onClick={handleSync} disabled={syncLoading()}>
                  {syncLoading() ? "syncing..." : "sync now"}
                </button>
                <Show when={!confirmLogout()}>
                  <button
                    onClick={() => setConfirmLogout(true)}
                    class="secondary"
                  >
                    logout
                  </button>
                </Show>
                <Show when={confirmLogout()}>
                  <button onClick={handleLogout} class="danger">
                    confirm logout
                  </button>
                  <button
                    onClick={() => setConfirmLogout(false)}
                    class="secondary"
                  >
                    cancel
                  </button>
                </Show>
              </div>

              <Show when={syncResult()}>
                <div class="sync-result">
                  <div class="stat">
                    <span class="num">{syncResult()?.groups_found}</span>
                    <span class="label">groups</span>
                  </div>
                  <div class="stat">
                    <span class="num">{syncResult()?.members_found}</span>
                    <span class="label">members</span>
                  </div>
                  <div class="stat">
                    <span class="num">{syncResult()?.users_updated}</span>
                    <span class="label">synced</span>
                  </div>
                  <div class="stat">
                    <span class="num">
                      {syncResult()?.peer_nodes_registered}
                    </span>
                    <span class="label">peers</span>
                  </div>
                </div>
              </Show>
            </section>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
