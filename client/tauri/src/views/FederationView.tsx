import { createSignal, onMount, Show, For, createEffect, on } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

interface FederationConfigStatus {
  enabled: boolean;
  haruspex_url: string;
  haruspex_anon_key: string;
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

interface PeerNodeInfo {
  user_id: string;
  node_id: string;
  instance_name: string | null;
  created_at: number;
  last_seen_at: number | null;
  username: string;
  role: string;
}

interface KnockInfo {
  id: string;
  node_id: string;
  username: string;
  message: string;
  status: string;
  created_at: number;
  processed_at: number | null;
  processed_by: string | null;
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

  // peer list
  const [peerNodes, setPeerNodes] = createSignal<PeerNodeInfo[]>([]);
  const [peersLoading, setPeersLoading] = createSignal(false);
  const [removingPeerId, setRemovingPeerId] = createSignal<string | null>(null);

  // knock requests
  const [knocks, setKnocks] = createSignal<KnockInfo[]>([]);
  const [knocksLoading, setKnocksLoading] = createSignal(false);
  const [processingKnockId, setProcessingKnockId] = createSignal<string | null>(
    null,
  );
  const [acceptKnockUsername, setAcceptKnockUsername] = createSignal("");
  const [acceptKnockRole, setAcceptKnockRole] = createSignal("viewer");
  const [expandedKnockId, setExpandedKnockId] = createSignal<string | null>(
    null,
  );
  const [confirmRejectAll, setConfirmRejectAll] = createSignal(false);

  // copy feedback
  const [nodeIdCopied, setNodeIdCopied] = createSignal(false);
  const [copiedPeerNodeId, setCopiedPeerNodeId] = createSignal<string | null>(
    null,
  );

  onMount(async () => {
    await loadStatus();
    await loadPeers();
    await loadKnocks();
  });

  // auto-refresh knocks periodically when federation is enabled
  createEffect(
    on(
      () => isConfigured(),
      (enabled) => {
        if (!enabled) return;
        const interval = setInterval(() => {
          loadKnocks();
        }, 30000); // refresh every 30 seconds
        return () => clearInterval(interval);
      },
    ),
  );

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
                haruspex_anon_key: "",
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

    try {
      const result = await invoke<AllowPeerResult>("allow_peer", {
        nodeId: peerNodeId(),
        username: peerUsername() || undefined,
        role: peerRole(),
      });
      setSuccess(
        result.created_user
          ? `peer allowed: created user "${result.username}"`
          : `peer allowed: linked to existing user "${result.username}"`,
      );
      // clear form and refresh peer list
      setPeerNodeId("");
      setPeerUsername("");
      await loadPeers();
    } catch (e) {
      setError(String(e));
    } finally {
      setAllowPeerLoading(false);
    }
  }

  async function loadPeers() {
    setPeersLoading(true);
    try {
      const peers = await invoke<PeerNodeInfo[]>("list_peer_nodes");
      setPeerNodes(peers);
    } catch (e) {
      console.error("failed to load peers:", e);
    } finally {
      setPeersLoading(false);
    }
  }

  async function removePeer(userId: string, nodeId: string) {
    setRemovingPeerId(nodeId);
    setError("");

    try {
      await invoke("remove_peer_node", { userId, nodeId });
      await loadPeers();
      setSuccess("peer removed");
    } catch (e) {
      setError(String(e));
    } finally {
      setRemovingPeerId(null);
    }
  }

  // knock request functions
  async function loadKnocks() {
    setKnocksLoading(true);
    try {
      const result = await invoke<KnockInfo[]>("list_knocks", {
        includeAll: false,
      });
      setKnocks(result);
    } catch (e) {
      console.error("failed to load knocks:", e);
    } finally {
      setKnocksLoading(false);
    }
  }

  async function handleAcceptKnock(knock: KnockInfo) {
    setProcessingKnockId(knock.id);
    setError("");
    setSuccess("");

    try {
      const username = acceptKnockUsername() || knock.username || undefined;
      await invoke("accept_knock", {
        knockId: knock.id,
        username,
        role: acceptKnockRole(),
      });
      setSuccess(
        `accepted knock from "${username || knock.username}" as ${acceptKnockRole()}`,
      );
      // clear form state
      setExpandedKnockId(null);
      setAcceptKnockUsername("");
      setAcceptKnockRole("viewer");
      // refresh lists
      await loadKnocks();
      await loadPeers();
    } catch (e) {
      setError(String(e));
    } finally {
      setProcessingKnockId(null);
    }
  }

  async function handleRejectKnock(knockId: string) {
    setProcessingKnockId(knockId);
    setError("");

    try {
      await invoke("reject_knock", { knockId });
      setSuccess("knock request rejected");
      await loadKnocks();
    } catch (e) {
      setError(String(e));
    } finally {
      setProcessingKnockId(null);
    }
  }

  async function handleDeleteKnock(knockId: string) {
    setProcessingKnockId(knockId);
    setError("");

    try {
      await invoke("delete_knock", { knockId });
      await loadKnocks();
    } catch (e) {
      setError(String(e));
    } finally {
      setProcessingKnockId(null);
    }
  }

  async function handleRejectAllKnocks() {
    setError("");
    setSuccess("");
    setConfirmRejectAll(false);

    try {
      const rejected = await invoke<number>("reject_all_knocks");
      setSuccess(`rejected ${rejected} pending knock request(s)`);
      await loadKnocks();
    } catch (e) {
      setError(String(e));
    }
  }

  function formatNodeId(nodeId: string): string {
    if (nodeId.length <= 16) return nodeId;
    return `${nodeId.slice(0, 8)}...${nodeId.slice(-8)}`;
  }

  function formatTimestamp(ts: number): string {
    return new Date(ts * 1000).toLocaleDateString();
  }

  function formatRelativeTime(ts: number): string {
    const now = Date.now();
    const diff = now - ts * 1000;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }

  const isConfigured = () => status()?.config?.enabled ?? false;
  const hasHaruspexConfig = () => {
    const cfg = status()?.config;
    return cfg?.haruspex_url && cfg?.haruspex_anon_key;
  };
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
        {/* configuration & identity status */}
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
              <Show when={status()?.config?.haruspex_url}>
                <div class="status-item">
                  <span class="label">haruspex url</span>
                  <span class="value mono">
                    {status()?.config?.haruspex_url}
                  </span>
                </div>
              </Show>
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
              <div class="status-item full-width">
                <span class="label">keypair</span>
                <span class="value mono small">
                  {hasKeypair()
                    ? status()?.identity.keypair_path
                    : "not generated"}
                </span>
              </div>
              <Show when={hasKeypair()}>
                <div class="status-item full-width">
                  <span class="label">node id</span>
                  <span class="value mono small">
                    {status()?.identity.node_id}
                  </span>
                  <button
                    class="secondary small copy-btn"
                    onClick={async () => {
                      const nodeId = status()?.identity.node_id;
                      if (nodeId) {
                        await navigator.clipboard.writeText(nodeId);
                        setNodeIdCopied(true);
                        setTimeout(() => setNodeIdCopied(false), 5000);
                      }
                    }}
                  >
                    {nodeIdCopied() ? "copied!" : "copy"}
                  </button>
                </div>
              </Show>
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

        {/* allowed peers - only show when federation is enabled */}
        <Show when={isConfigured()}>
          <section class="status-section">
            <h2>allowed peers</h2>
            <p class="help-text">
              list of all P2P peers that can connect to this instance. peers can
              be added manually below
              {hasHaruspexConfig() ? " or synced from haruspex" : ""}.
            </p>

            {/* peer list */}
            <Show when={peerNodes().length > 0}>
              <div class="peer-list">
                <For each={peerNodes()}>
                  {(peer) => (
                    <div class="peer-item">
                      <div class="peer-info">
                        <span class="peer-username">{peer.username}</span>
                        <span class="peer-role">{peer.role}</span>
                      </div>
                      <div
                        class="peer-node-id clickable"
                        title="click to copy to clipboard"
                        onClick={async () => {
                          await navigator.clipboard.writeText(peer.node_id);
                          setCopiedPeerNodeId(peer.node_id);
                          setTimeout(() => setCopiedPeerNodeId(null), 3000);
                        }}
                      >
                        {copiedPeerNodeId() === peer.node_id
                          ? "copied!"
                          : formatNodeId(peer.node_id)}
                      </div>
                      <div class="peer-meta">
                        <span>added {formatTimestamp(peer.created_at)}</span>
                        <Show when={peer.instance_name}>
                          <span class="instance-name">
                            {peer.instance_name}
                          </span>
                        </Show>
                      </div>
                      <button
                        class="peer-remove"
                        onClick={() => removePeer(peer.user_id, peer.node_id)}
                        disabled={removingPeerId() === peer.node_id}
                        title="remove peer"
                      >
                        {removingPeerId() === peer.node_id ? "..." : "×"}
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <Show when={peerNodes().length === 0 && !peersLoading()}>
              <div class="status-message" style="margin-bottom: 1rem">
                no peers allowed yet
              </div>
            </Show>

            {/* add peer form */}
            <details class="add-peer-form">
              <summary>add peer manually</summary>
              <form onSubmit={handleAllowPeer}>
                <div class="form-row">
                  <div class="form-group flex-1">
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
                </div>
                <div class="form-row">
                  <div class="form-group flex-1">
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
                      <option value="viewer">viewer</option>
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                  </div>
                </div>
                <button type="submit" disabled={allowPeerLoading()}>
                  {allowPeerLoading() ? "adding..." : "add peer"}
                </button>
              </form>
            </details>
          </section>

          {/* access requests (knocks) - show pending knock requests */}
          <section class="status-section">
            <h2>access requests</h2>
            <p class="help-text">
              incoming requests from peers who want access to your instance.
              accept to create a user and allow P2P connections.
            </p>

            <Show when={knocksLoading()}>
              <div class="status-message">loading requests...</div>
            </Show>

            <Show when={!knocksLoading() && knocks().length === 0}>
              <div class="status-message">no pending access requests</div>
            </Show>

            <Show when={knocks().length > 0}>
              <div class="knock-list">
                <For each={knocks()}>
                  {(knock) => (
                    <div class="knock-item">
                      <div class="knock-header">
                        <div class="knock-info">
                          <span class="knock-username">
                            {knock.username || "unknown"}
                          </span>
                          <span class="knock-time">
                            {formatRelativeTime(knock.created_at)}
                          </span>
                        </div>
                      </div>
                      <Show when={knock.message}>
                        <div class="knock-message">{knock.message}</div>
                      </Show>
                      <Show when={expandedKnockId() === knock.id}>
                        <div class="knock-accept-form">
                          <div class="form-row">
                            <div class="form-group flex-1">
                              <label>username</label>
                              <input
                                type="text"
                                value={acceptKnockUsername() || knock.username}
                                onInput={(e) =>
                                  setAcceptKnockUsername(e.currentTarget.value)
                                }
                                placeholder={knock.username || "enter username"}
                              />
                            </div>
                            <div class="form-group">
                              <label>role</label>
                              <select
                                value={acceptKnockRole()}
                                onChange={(e) =>
                                  setAcceptKnockRole(e.currentTarget.value)
                                }
                              >
                                <option value="viewer">viewer</option>
                                <option value="member">member</option>
                                <option value="admin">admin</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      </Show>
                      <div class="knock-actions">
                        <Show when={expandedKnockId() === knock.id}>
                          <button
                            class="small"
                            onClick={() => handleAcceptKnock(knock)}
                            disabled={processingKnockId() === knock.id}
                          >
                            {processingKnockId() === knock.id
                              ? "..."
                              : "confirm"}
                          </button>
                          <button
                            class="secondary small"
                            onClick={() => {
                              setExpandedKnockId(null);
                              setAcceptKnockUsername("");
                              setAcceptKnockRole("viewer");
                            }}
                          >
                            cancel
                          </button>
                        </Show>
                        <Show when={expandedKnockId() !== knock.id}>
                          <button
                            class="small"
                            onClick={() => setExpandedKnockId(knock.id)}
                            disabled={processingKnockId() === knock.id}
                          >
                            accept
                          </button>
                          <button
                            class="secondary small"
                            onClick={() => handleRejectKnock(knock.id)}
                            disabled={processingKnockId() === knock.id}
                          >
                            {processingKnockId() === knock.id
                              ? "..."
                              : "reject"}
                          </button>
                          <button
                            class="secondary small"
                            onClick={() => handleDeleteKnock(knock.id)}
                            disabled={processingKnockId() === knock.id}
                            title="delete request"
                          >
                            delete
                          </button>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
              <Show when={knocks().length > 1}>
                <div class="section-actions" style="margin-top: 1rem">
                  <Show when={!confirmRejectAll()}>
                    <button
                      class="secondary small"
                      onClick={() => setConfirmRejectAll(true)}
                    >
                      reject all
                    </button>
                  </Show>
                  <Show when={confirmRejectAll()}>
                    <button
                      class="danger small"
                      onClick={handleRejectAllKnocks}
                    >
                      confirm reject all
                    </button>
                    <button
                      class="secondary small"
                      onClick={() => setConfirmRejectAll(false)}
                    >
                      cancel
                    </button>
                  </Show>
                </div>
              </Show>
            </Show>
          </section>

          {/* credentials status with sign-in form - only show if haruspex is configured */}
          <Show when={hasHaruspexConfig()}>
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
          </Show>

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
