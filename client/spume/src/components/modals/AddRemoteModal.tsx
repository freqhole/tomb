// add remote modal - multi-step wizard for adding a new remote server
// steps: 1) enter url/peer, 2) test connection, 3) authenticate, 4) complete
import { createEffect, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { getClientForRemote, isTauriAvailable } from "../../app/api/client";
import { authenticate, getServerInfo, whoami } from "../../app/services/remotes/authService";
import { createRemote, getAllRemotes } from "../../app/services/remotes/remoteManager";
import {
  createPendingRemote,
  deletePendingRemote,
  deletePendingRemoteByPeerAddr,
  getAllPendingRemotes,
  getPendingRemoteByPeerAddr,
  updatePendingRemote,
} from "../../app/services/storage/db";
import type { PendingRemote } from "../../app/services/storage/types";
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
  onSuccess?: (remote: {
    remote_id: string;
    name: string;
    base_url?: string;
    peer_addr?: string;
  }) => void;
}

type Step = "url" | "testing" | "auth" | "complete" | "knock-sent";

export function AddRemoteModal(props: AddRemoteModalProps) {
  const [step, setStep] = createSignal<Step>("url");
  const [inputValue, setInputValue] = createSignal(""); // raw user input, preserved across steps
  const [url, setUrl] = createSignal(""); // parsed HTTP URL
  const [peerAddr, setPeerAddr] = createSignal<string | null>(null); // set when input is P2P
  const [error, setError] = createSignal<string | null>(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [testingStatus, setTestingStatus] = createSignal<string | null>(null); // progress status during testing
  const [foundPeer, setFoundPeer] = createSignal(false); // true when P2P connection succeeds
  const [abortController, setAbortController] = createSignal<AbortController | null>(null);
  const [serverInfo, setServerInfo] = createSignal<{
    name: string;
    description?: string | null;
    version: string;
    image_url?: string | null;
    image_blob_id?: string | null;
    requiresAuth: boolean;
    knocking_enabled?: boolean | null;
  } | null>(null);

  // pre-fetched P2P server image URL (stored as object URL during connection test)
  const [p2pImageUrl, setP2pImageUrl] = createSignal<string | null>(null);
  // cached image data for storing in IDB with pending knock
  const [p2pImageData, setP2pImageData] = createSignal<{ data: string; type: string } | null>(null);

  // debug: log when p2pImageUrl changes
  createEffect(() => {
    const imgUrl = p2pImageUrl();
    console.log("[AddRemoteModal] p2pImageUrl changed:", imgUrl);
  });

  // pending remotes state (tracks in-progress remote additions, including knocks)
  const [pendingRemotes, setPendingRemotes] = createSignal<PendingRemote[]>([]);
  const [showKnockOption, setShowKnockOption] = createSignal(false); // show request access after failed P2P connection

  // hint: if current origin is a valid remote server that's not already added
  const [originHint, setOriginHint] = createSignal<string | null>(null);

  // load pending remotes when modal opens
  createEffect(
    on(
      () => props.isOpen,
      async (isOpen) => {
        if (!isOpen) return;
        try {
          const remotes = await getAllPendingRemotes();
          setPendingRemotes(remotes);
        } catch (err) {
          console.error("failed to load pending remotes:", err);
        }
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
          // check if already added
          const existingRemotes = await getAllRemotes();
          if (existingRemotes.some((r) => r.base_url === origin)) {
            setOriginHint(null);
            return;
          }

          // try to hit the hello endpoint
          const helloResult = await getServerInfo(origin);
          if (helloResult.success && helloResult.data?.name) {
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

    const input = inputValue().trim();

    if (!input) {
      setError("please enter a server url or peer id");
      return;
    }

    // detect if this is a P2P address or HTTP URL
    const parsed = parsePeerAddress(input);

    if (parsed?.type === "p2p") {
      // P2P connection via midden
      setPeerAddr(parsed.peer_addr);
      setUrl(""); // clear URL for P2P (peerAddr is used instead)
      setIsLoading(true);
      setTestingStatus(null); // reset status
      setFoundPeer(false); // reset found peer status
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

        setFoundPeer(true); // mark connection as successful!
        setTestingStatus(`connected to ${info.name}`);
        console.log("[AddRemoteModal] server info received:", {
          name: info.name,
          image_url: info.image_url,
          image_blob_id: info.image_blob_id,
          knocking_enabled: info.knocking_enabled,
        });

        // save server info first
        setServerInfo({
          name: info.name,
          description: info.description,
          version: info.version,
          image_url: info.image_url,
          image_blob_id: info.image_blob_id,
          requiresAuth: false, // P2P registration uses invite code only - no passkey needed
          knocking_enabled: info.knocking_enabled,
        });

        // check if user already has access via whoami BEFORE fetching image
        setTestingStatus(`checking access to ${info.name}...`);
        try {
          const whoamiResult = await client.auth.whoami();
          if (whoamiResult.success && whoamiResult.data) {
            console.log(
              "[AddRemoteModal] P2P whoami succeeded - user has access:",
              whoamiResult.data
            );
            // user already has access, skip to complete
            await completeSetup();
            return;
          }
        } catch (whoamiErr) {
          console.log(
            "[AddRemoteModal] P2P whoami failed (expected if not registered):",
            whoamiErr
          );
          // whoami failed - user needs to register, continue to fetch image for auth step
        }

        // try to fetch server image via dedicated HelloImageRequest (public, no auth required)
        // only needed if user doesn't have access yet (for pending knock display)
        setTestingStatus(`fetching server image from ${info.name}...`);
        console.log("[AddRemoteModal] attempting to fetch server image via fetchHelloImage");
        try {
          if (client.transport.fetchHelloImage) {
            const blobData = await client.transport.fetchHelloImage();
            console.log("[AddRemoteModal] server image fetch result:", {
              hasData: !!blobData?.data,
              dataLength: blobData?.data?.length,
              contentType: blobData?.contentType,
            });
            if (blobData?.data && blobData.data.length > 0) {
              const blob = new Blob([new Uint8Array(blobData.data)], {
                type: blobData.contentType,
              });
              const objectUrl = URL.createObjectURL(blob);
              console.log("[AddRemoteModal] created server image URL:", objectUrl);
              setP2pImageUrl(objectUrl);
              // cache base64 for storing with pending knock
              const bytes = new Uint8Array(blobData.data);
              let binary = "";
              for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              setP2pImageData({ data: btoa(binary), type: blobData.contentType });
            }
          } else {
            console.log("[AddRemoteModal] fetchHelloImage not available on transport");
          }
        } catch (imgErr) {
          console.error("[AddRemoteModal] server image fetch failed:", imgErr);
          // image fetch failed, continue without it
        }

        // create or update pending remote for recovery if user closes modal
        const existingPending = await getPendingRemoteByPeerAddr(parsed.peer_addr);
        const imageData = p2pImageData();
        if (existingPending) {
          await updatePendingRemote(existingPending.id, {
            stage: "connected",
            server_name: info.name,
            server_description: info.description,
            server_version: info.version,
            server_image_data: imageData?.data ?? existingPending.server_image_data,
            server_image_type: imageData?.type ?? existingPending.server_image_type,
          });
        } else {
          await createPendingRemote({
            peer_addr: parsed.peer_addr,
            transport: isTauriAvailable() ? "app" : "wasm",
            stage: "connected",
            server_name: info.name,
            server_description: info.description,
            server_version: info.version,
            server_image_data: imageData?.data ?? null,
            server_image_type: imageData?.type ?? null,
            knock_username: null,
            knock_message: null,
          });
        }
        // refresh the list
        const remotes = await getAllPendingRemotes();
        setPendingRemotes(remotes);

        // move to auth step - P2P requires registration
        setStep("auth");
      } catch (err) {
        // ignore if cancelled
        if (controller.signal.aborted) return;

        console.error("failed to connect via P2P:", err);

        // provide more helpful error message
        const errMsg = err instanceof Error ? err.message : String(err);

        // check if this is a 401/403 with knocking enabled - show request access option
        const is401or403 =
          errMsg.includes("401") ||
          errMsg.includes("403") ||
          errMsg.includes("Unauthorized") ||
          errMsg.includes("Forbidden");

        // try to get server info even on auth error to check knocking_enabled
        // hello endpoint is public so it should work
        if (is401or403) {
          console.log("[AddRemoteModal] 401/403 detected, trying to get server info...");
          try {
            const serverInfoClient = await getClientForRemote({
              peer_addr: parsed.peer_addr,
              transport_type: isTauriAvailable() ? "app" : "wasm",
            });
            const helloResult = await serverInfoClient.app.serverInfo();
            if (helloResult.success && helloResult.data) {
              const info = helloResult.data;
              console.log("[AddRemoteModal] 401/403 path - server info:", {
                name: info.name,
                image_blob_id: info.image_blob_id,
                knocking_enabled: info.knocking_enabled,
              });

              // try to fetch server image via dedicated HelloImageRequest (public, no auth required)
              if (!controller.signal.aborted) {
                console.log("[AddRemoteModal] 401/403 path - fetching image via fetchHelloImage");
                try {
                  if (serverInfoClient.transport.fetchHelloImage) {
                    const blobData = await serverInfoClient.transport.fetchHelloImage();
                    console.log("[AddRemoteModal] 401/403 path - image result:", {
                      hasData: !!blobData?.data,
                      dataLength: blobData?.data?.length,
                    });
                    if (blobData?.data) {
                      const blob = new Blob([new Uint8Array(blobData.data)], {
                        type: blobData.contentType,
                      });
                      const objectUrl = URL.createObjectURL(blob);
                      console.log("[AddRemoteModal] 401/403 path - created URL:", objectUrl);
                      setP2pImageUrl(objectUrl);
                      // cache base64 for storing with pending knock
                      const bytes = new Uint8Array(blobData.data);
                      let binary = "";
                      for (let i = 0; i < bytes.length; i++) {
                        binary += String.fromCharCode(bytes[i]);
                      }
                      setP2pImageData({ data: btoa(binary), type: blobData.contentType });
                    }
                  } else {
                    console.log("[AddRemoteModal] 401/403 path - fetchHelloImage not available");
                  }
                } catch (imgErr) {
                  console.error("[AddRemoteModal] 401/403 path - image fetch failed:", imgErr);
                  // image fetch failed, continue without it
                }
              }

              setServerInfo({
                name: info.name,
                description: info.description,
                version: info.version,
                image_url: info.image_url,
                image_blob_id: info.image_blob_id,
                requiresAuth: true,
                knocking_enabled: info.knocking_enabled,
              });

              // create or update pending remote even on 401/403 - we got server info
              const existingPending = await getPendingRemoteByPeerAddr(parsed.peer_addr);
              const imageData = p2pImageData();
              if (existingPending) {
                await updatePendingRemote(existingPending.id, {
                  stage: "connected",
                  server_name: info.name,
                  server_description: info.description,
                  server_version: info.version,
                  server_image_data: imageData?.data ?? existingPending.server_image_data,
                  server_image_type: imageData?.type ?? existingPending.server_image_type,
                });
              } else {
                await createPendingRemote({
                  peer_addr: parsed.peer_addr,
                  transport: isTauriAvailable() ? "app" : "wasm",
                  stage: "connected",
                  server_name: info.name,
                  server_description: info.description,
                  server_version: info.version,
                  server_image_data: imageData?.data ?? null,
                  server_image_type: imageData?.type ?? null,
                  knock_username: null,
                  knock_message: null,
                });
              }
              // refresh the list
              const remotes = await getAllPendingRemotes();
              setPendingRemotes(remotes);

              if (info.knocking_enabled) {
                setShowKnockOption(true);
                setError(`access denied - you can request access from the server admin`);
                setStep("url");
                return;
              }
            }
          } catch {
            // couldn't get server info, just show the regular error
          }
        }

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
    setInputValue(remoteUrl); // update input to show normalized URL

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
    setTestingStatus(null); // reset status
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
          name: info.name,
          description: info.description,
          version: info.version,
          image_url: info.image_url,
          image_blob_id: info.image_blob_id,
          requiresAuth: true,
        });
        await completeSetup();
        return;
      }

      // not authenticated yet - show server info and move to auth step
      setServerInfo({
        name: info.name,
        description: info.description,
        version: info.version,
        image_url: info.image_url,
        image_blob_id: info.image_blob_id,
        requiresAuth: true,
      });

      // create or update pending remote for recovery if user closes modal
      const existingPending = await getPendingRemoteByPeerAddr(remoteUrl);
      if (existingPending) {
        await updatePendingRemote(existingPending.id, {
          stage: "connected",
          server_name: info.name,
          server_description: info.description,
          server_version: info.version,
        });
      } else {
        await createPendingRemote({
          peer_addr: remoteUrl, // for HTTP, use URL as peer_addr
          transport: "http",
          stage: "connected",
          server_name: info.name,
          server_description: info.description,
          server_version: info.version,
          server_image_data: null, // HTTP remotes fetch images via URL
          server_image_type: null,
          knock_username: null,
          knock_message: null,
        });
      }
      // refresh the list
      const remotes = await getAllPendingRemotes();
      setPendingRemotes(remotes);

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

      // delete pending remote now that we have a real remote
      const peerAddrKey = currentPeerAddr || remoteUrl;
      if (peerAddrKey) {
        await deletePendingRemoteByPeerAddr(peerAddrKey);
        const remotes = await getAllPendingRemotes();
        setPendingRemotes(remotes);
      }

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

  // handle requesting access via knock
  const handleRequestAccess = async (username: string, message: string) => {
    const currentPeerAddr = peerAddr();
    if (!currentPeerAddr) {
      setError("no peer address available");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const client = await getClientForRemote({
        peer_addr: currentPeerAddr,
        transport_type: isTauriAvailable() ? "app" : "wasm",
      });

      debug("knock", "sending knock request...");
      const result = await client.admin.createKnockPublic({
        username,
        message,
      });

      if (!result.success) {
        throw new Error(
          "error" in result ? formatErrorMessage(result.error) : "knock request failed"
        );
      }

      debug("knock", "knock request sent successfully");

      // update existing pending remote or create new one with knock_pending stage
      const info = serverInfo();
      const imageData = p2pImageData();
      const existingPending = await getPendingRemoteByPeerAddr(currentPeerAddr);

      if (existingPending) {
        // update existing pending remote with knock details
        await updatePendingRemote(existingPending.id, {
          stage: "knock_pending",
          knock_username: username,
          knock_message: message,
          // refresh server info if we have newer data
          server_name: info?.name ?? existingPending.server_name,
          server_description: info?.description ?? existingPending.server_description,
          server_version: info?.version ?? existingPending.server_version,
          server_image_data: imageData?.data ?? existingPending.server_image_data,
          server_image_type: imageData?.type ?? existingPending.server_image_type,
        });
      } else {
        // create new pending remote
        await createPendingRemote({
          peer_addr: currentPeerAddr,
          transport: isTauriAvailable() ? "app" : "wasm",
          stage: "knock_pending",
          server_name: info?.name ?? null,
          server_description: info?.description ?? null,
          server_version: info?.version ?? null,
          server_image_data: imageData?.data ?? null,
          server_image_type: imageData?.type ?? null,
          knock_username: username,
          knock_message: message,
        });
      }

      // refresh pending remotes list
      const remotes = await getAllPendingRemotes();
      setPendingRemotes(remotes);

      setShowKnockOption(false);
      setStep("knock-sent");
    } catch (err) {
      console.error("failed to send knock request:", err);
      setError(err instanceof Error ? err.message : "failed to send access request");
    } finally {
      setIsLoading(false);
    }
  };

  // retry a pending remote to see if knock was accepted
  const handleRetryKnock = async (pending: PendingRemote) => {
    setInputValue(pending.peer_addr);
    setPeerAddr(pending.peer_addr);
    setError(null);
    setShowKnockOption(false);
    setIsLoading(true);
    setTestingStatus(null); // reset status
    setStep("testing");

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const client = await getClientForRemote({
        peer_addr: pending.peer_addr,
        transport_type: isTauriAvailable() ? "app" : "wasm",
      });

      if (controller.signal.aborted) return;

      // check knock status first
      const statusResult = await client.admin.getKnockStatusPublic();

      if (controller.signal.aborted) return;

      // update last checked time
      await updatePendingRemote(pending.id, {});
      const remotes = await getAllPendingRemotes();
      setPendingRemotes(remotes);

      if (statusResult.success && statusResult.data) {
        const status = statusResult.data;

        if (status.status === "accepted") {
          // knock was accepted! try to get full server info
          const infoResult = await client.app.serverInfo();

          if (infoResult.success && infoResult.data) {
            const info = infoResult.data;
            setServerInfo({
              name: info.name,
              description: info.description,
              version: info.version,
              image_url: info.image_url,
              image_blob_id: info.image_blob_id,
              requiresAuth: false,
              knocking_enabled: info.knocking_enabled,
            });
          }

          // remove from pending remotes
          await deletePendingRemote(pending.id);
          const updatedRemotes = await getAllPendingRemotes();
          setPendingRemotes(updatedRemotes);

          // check if user already has access via whoami
          setTestingStatus("checking access...");
          try {
            const whoamiResult = await client.auth.whoami();
            if (whoamiResult.success && whoamiResult.data) {
              console.log("[AddRemoteModal] knock accepted & whoami succeeded - completing setup");
              await completeSetup();
              return;
            }
          } catch (whoamiErr) {
            console.log("[AddRemoteModal] whoami failed after knock accepted:", whoamiErr);
          }

          // fallback to auth step if whoami failed
          setStep("auth");
          return;
        } else if (status.status === "rejected") {
          // knock was rejected
          await updatePendingRemote(pending.id, { stage: "knock_rejected" });
          const updatedRemotes = await getAllPendingRemotes();
          setPendingRemotes(updatedRemotes);

          setError("your access request was rejected by the server admin");
          setStep("url");
          return;
        }

        // still pending
        setError("access request is still pending - the server admin has not yet responded");
        setStep("url");
      } else {
        // couldn't get status, try a regular connection
        const infoResult = await client.app.serverInfo();

        if (infoResult.success && infoResult.data) {
          // connection succeeded! knock must have been accepted
          const info = infoResult.data;
          setServerInfo({
            name: info.name,
            description: info.description,
            version: info.version,
            image_url: info.image_url,
            image_blob_id: info.image_blob_id,
            requiresAuth: false,
            knocking_enabled: info.knocking_enabled,
          });

          await deletePendingRemote(pending.id);
          const updatedRemotes = await getAllPendingRemotes();
          setPendingRemotes(updatedRemotes);

          // check if user already has access via whoami
          setTestingStatus("checking access...");
          try {
            const whoamiResult = await client.auth.whoami();
            if (whoamiResult.success && whoamiResult.data) {
              console.log(
                "[AddRemoteModal] connection succeeded & whoami succeeded - completing setup"
              );
              await completeSetup();
              return;
            }
          } catch (whoamiErr) {
            console.log("[AddRemoteModal] whoami failed despite connection success:", whoamiErr);
          }

          // fallback to auth step if whoami failed
          setStep("auth");
        } else {
          setError("still waiting for access approval");
          setStep("url");
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;

      console.error("failed to check knock status:", err);
      setError("still waiting for access approval - server may be offline");
      setStep("url");
    } finally {
      setIsLoading(false);
      setAbortController(null);
    }
  };

  // delete a pending remote
  const handleDeletePending = async (pending: PendingRemote) => {
    try {
      await deletePendingRemote(pending.id);
      const remotes = await getAllPendingRemotes();
      setPendingRemotes(remotes);
    } catch (err) {
      console.error("failed to delete pending remote:", err);
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
    setInputValue("");
    setUrl("");
    setPeerAddr(null);
    setError(null);
    setServerInfo(null);
    setOriginHint(null);
    setShowKnockOption(false);
    setIsLoading(false);
    // revoke and clear P2P image URL
    const imgUrl = p2pImageUrl();
    if (imgUrl) {
      URL.revokeObjectURL(imgUrl);
      setP2pImageUrl(null);
    }
    props.onClose();
  };

  const canGoBack = () => {
    return step() === "auth" || step() === "knock-sent" || (step() === "testing" && isLoading());
  };

  const handleBack = () => {
    if (step() === "auth" || step() === "knock-sent") {
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
          class="bg-[var(--color-bg-primary)] rounded-lg shadow-xl max-w-md w-full border border-[var(--color-border-default)] flex flex-col max-h-[80dvh]"
          onClick={(e) => e.stopPropagation()}
        >
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
          <div class="p-6 overflow-y-auto flex-1 min-h-0">
            <Switch>
              {/* step 1: enter url */}
              <Match when={step() === "url"}>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (showKnockOption()) {
                      // submit request access form
                      const form = e.currentTarget;
                      const usernameInput = form.querySelector<HTMLInputElement>("#knock-username");
                      const messageInput =
                        form.querySelector<HTMLTextAreaElement>("#knock-message");
                      const username = usernameInput?.value?.trim() || "";
                      const message = messageInput?.value?.trim() || "";
                      if (!username) {
                        setError("please enter a username");
                      } else if (!message) {
                        setError("please enter a message - tell the admin who you are");
                      } else {
                        handleRequestAccess(username, message);
                      }
                    } else {
                      handleTestConnection();
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
                    <input
                      id="remote-url"
                      type="text"
                      value={inputValue()}
                      onInput={(e) => {
                        setInputValue(e.currentTarget.value);
                        setShowKnockOption(false); // reset knock option when input changes
                      }}
                      placeholder="https://music.example.com or node_id"
                      class="w-full px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-md text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-primary)] focus:border-transparent font-mono text-sm"
                      disabled={isLoading() || showKnockOption()}
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

                  {/* request access form - shown when knocking is enabled */}
                  <Show when={showKnockOption()}>
                    {/* server info display - same as auth step */}
                    <Show when={serverInfo()}>
                      <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-md">
                        <div class="flex items-start gap-3">
                          <MediaImage
                            imageUrl={p2pImageUrl()}
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
                              P2P • version {serverInfo()?.version}
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
                          disabled={isLoading()}
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
                          disabled={isLoading()}
                        />
                      </div>
                    </div>
                  </Show>

                  <Show when={!showKnockOption()}>
                    <Button type="submit" variant="primary" disabled={isLoading()} class="w-full">
                      test connection
                    </Button>
                  </Show>
                  <Show when={showKnockOption()}>
                    <div class="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setShowKnockOption(false);
                          setError(null);
                        }}
                        class="flex-1"
                      >
                        cancel
                      </Button>
                      <Button type="submit" variant="primary" disabled={isLoading()} class="flex-1">
                        {isLoading() ? "sending..." : "request access"}
                      </Button>
                    </div>
                  </Show>

                  {/* hint: use current origin if it's a valid server */}
                  <Show when={originHint() && !showKnockOption()}>
                    <div class="text-center pt-2 border-t border-[var(--color-border-default)]">
                      <button
                        type="button"
                        class="text-sm text-[var(--color-accent-primary)] hover:underline"
                        onClick={() => {
                          setInputValue(originHint()!);
                          handleTestConnection();
                        }}
                        disabled={isLoading()}
                      >
                        use {originHint()}
                      </button>
                    </div>
                  </Show>

                  {/* pending remotes list */}
                  <Show when={pendingRemotes().length > 0}>
                    <div class="pt-4 border-t border-[var(--color-border-default)]">
                      <h3 class="text-sm font-medium text-[var(--color-text-primary)] mb-2">
                        pending connections
                      </h3>
                      <div class="space-y-2">
                        <For each={pendingRemotes()}>
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
                                  {pending.server_name || pending.peer_addr.slice(0, 16) + "..."}
                                </p>
                                <p class="text-xs text-[var(--color-text-tertiary)]">
                                  {pending.stage === "connected" && "ready to connect"}
                                  {pending.stage === "knock_pending" && "waiting for approval"}
                                  {pending.stage === "knock_accepted" && "access granted"}
                                  {pending.stage === "knock_rejected" && "request rejected"}
                                </p>
                              </div>
                              <div class="flex gap-1">
                                <button
                                  type="button"
                                  class="p-1.5 cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-accent-primary)] hover:bg-[var(--color-accent-primary)]/10 rounded transition-colors"
                                  onClick={() => handleRetryKnock(pending)}
                                  title={pending.stage === "connected" ? "continue setup" : "check status"}
                                  disabled={isLoading()}
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
              </Match>

              {/* step 2: testing connection */}
              <Match when={step() === "testing"}>
                <div class="flex flex-col items-center justify-center py-8 space-y-4">
                  <Show when={!foundPeer()}>
                    <div class="w-12 h-12 border-4 border-[var(--color-accent-primary)] border-t-transparent rounded-full animate-spin" />
                  </Show>
                  <Show when={foundPeer()}>
                    <p class="text-lg font-semibold text-[var(--color-accent-primary)]">
                      found peer!
                    </p>
                  </Show>
                  <p class="text-sm text-[var(--color-text-secondary)]">
                    {testingStatus() ||
                      (peerAddr()
                        ? `connecting via P2P to ${peerAddr()!.slice(0, 16)}...`
                        : `connecting to ${url()}...`)}
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
                            peerAddr()
                              ? p2pImageUrl() // use pre-fetched P2P image
                              : serverInfo()?.image_url
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
                            version {serverInfo()?.version}
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
                    hidePasskeyInfo={!!peerAddr() || isTauriAvailable()} // hide for P2P and tauri
                  />

                  {/* request access option for P2P when knocking is enabled */}
                  <Show when={peerAddr() && serverInfo()?.knocking_enabled}>
                    <div class="text-center pt-4 border-t border-[var(--color-border-default)]">
                      <p class="text-sm text-[var(--color-text-secondary)] mb-2">
                        don't have an invite code?
                      </p>
                      <button
                        type="button"
                        class="text-sm text-[var(--color-accent-primary)] hover:underline"
                        onClick={() => {
                          setShowKnockOption(true);
                          setStep("url");
                        }}
                        disabled={isLoading()}
                      >
                        request access from the admin
                      </button>
                    </div>
                  </Show>
                </div>
              </Match>

              {/* step: knock sent - waiting for approval */}
              <Match when={step() === "knock-sent"}>
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
