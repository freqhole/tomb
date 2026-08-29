// pairing modal for freqhole-player devices (player.freqhole.net-style p2p
// playback targets). deliberately a separate, small flow from
// AddRemoteModal/AddPeerFlow: player pairing has different semantics
// (pin handshake over a dedicated ALPN, no http/knock/auth concepts) -
// see docs/player-remote-site-plan.md phase 5.
import { createSignal, Show } from "solid-js";
import { isCharnelAvailable } from "../../app/api/client";
import { getCurrentUser } from "../../music/data/currentState";
import { pairWithPlayer } from "../../app/services/players/playerPairingClient";
import { savePairedPlayer } from "../../app/services/players/pairedPlayers";
import { toast } from "../feedback/Toast";
import { QrScanner } from "../inputs/QrScanner";
import { Button } from "../buttons/Button";

export interface PairPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (player: { node_id: string; display_name: string }) => void;
}

interface ScannedPlayerQr {
  node_id: string;
  name: string;
  role: "player_remote";
}

function base64UrlDecode(token: string): string {
  const pad = token.length % 4 === 0 ? "" : "=".repeat(4 - (token.length % 4));
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// player.freqhole.net's qr encodes `https://spume.freqhole.net/?p=<base64url
// json>` so any camera app can open spume directly - strip the url wrapper
// and decode the `p` param back to json. falls back to parsing `text`
// as-is for back-compat with older bare-json qr codes.
function parseScannedPlayerQr(text: string): ScannedPlayerQr | null {
  const trimmed = text.trim();
  let jsonText = trimmed;

  try {
    const url = new URL(trimmed);
    const pParam = url.searchParams.get("p");
    if (pParam) jsonText = base64UrlDecode(pParam);
  } catch {
    const match = trimmed.match(/[?&]p=([A-Za-z0-9_-]+)/);
    if (match) jsonText = base64UrlDecode(match[1]);
  }

  try {
    const parsed = JSON.parse(jsonText);
    if (parsed?.role === "player_remote" && typeof parsed.node_id === "string") {
      return parsed as ScannedPlayerQr;
    }
  } catch {
    // not JSON - fall through
  }
  return null;
}

export function PairPlayerModal(props: PairPlayerModalProps) {
  const [nodeId, setNodeId] = createSignal("");
  const [pin, setPin] = createSignal("");
  const [controllerName, setControllerName] = createSignal(getCurrentUser()?.username ?? "spume");
  const [playerNameHint, setPlayerNameHint] = createSignal<string | null>(null);
  const [showScanner, setShowScanner] = createSignal(false);
  const [status, setStatus] = createSignal<"idle" | "pairing" | "error">("idle");
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  const canScanQr = () => !isCharnelAvailable() && !!navigator.mediaDevices?.getUserMedia;

  const reset = () => {
    setNodeId("");
    setPin("");
    setPlayerNameHint(null);
    setStatus("idle");
    setErrorMessage(null);
  };

  const handleClose = () => {
    reset();
    props.onClose();
  };

  const handleScanResult = (text: string) => {
    setShowScanner(false);
    const scanned = parseScannedPlayerQr(text);
    if (!scanned) {
      toast.error("that qr code isn't a freqhole player pairing code");
      return;
    }
    setNodeId(scanned.node_id);
    setPlayerNameHint(scanned.name);
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const trimmedNodeId = nodeId().trim();
    const trimmedPin = pin().trim();
    if (!trimmedNodeId || !trimmedPin) return;

    setStatus("pairing");
    setErrorMessage(null);
    try {
      const result = await pairWithPlayer(
        trimmedNodeId,
        trimmedPin,
        controllerName().trim() || "spume"
      );
      if (!result.ok) {
        setStatus("error");
        setErrorMessage(result.reason ?? "pairing failed");
        return;
      }
      const displayName = playerNameHint() ?? `player ${trimmedNodeId.slice(0, 8)}`;
      const player = await savePairedPlayer(trimmedNodeId, displayName);
      toast.success(`paired with ${displayName}`);
      reset();
      props.onClose();
      props.onSuccess?.(player);
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Show when={props.isOpen}>
      <Show when={showScanner()}>
        <QrScanner
          onResult={handleScanResult}
          onError={(err) => toast.error(`qr scan error: ${err}`)}
          onClose={() => setShowScanner(false)}
        />
      </Show>

      <div
        class="bg-black/50 flex items-center justify-center p-4"
        style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, "z-index": 1050 }}
      >
        <div class="bg-[var(--color-bg-primary)] shadow-xl w-full max-w-md rounded-lg border border-[var(--color-border-default)]">
          <div class="flex items-center justify-between p-6 border-b border-[var(--color-border-default)]">
            <h2 class="text-xl font-bold text-[var(--color-text-primary)]">pair a player</h2>
            <button
              type="button"
              class="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              onClick={handleClose}
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

          <form onSubmit={handleSubmit} class="p-6 space-y-4">
            <div>
              <label class="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                player node id
              </label>
              <div class="flex gap-2">
                <input
                  type="text"
                  value={nodeId()}
                  onInput={(e) => setNodeId(e.currentTarget.value)}
                  placeholder="scan the player's qr code or paste its node id"
                  class="flex-1 px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-md text-[var(--color-text-primary)] font-mono text-sm"
                  disabled={status() === "pairing"}
                />
                <Show when={canScanQr()}>
                  <button
                    type="button"
                    onClick={() => setShowScanner(true)}
                    class="px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-md text-[var(--color-text-secondary)]"
                    title="scan QR code"
                  >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              <Show when={playerNameHint()}>
                {(name) => (
                  <p class="mt-1 text-xs text-[var(--color-text-tertiary)]">scanned: {name()}</p>
                )}
              </Show>
            </div>

            <div>
              <label class="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                pin (shown on the player's screen)
              </label>
              <input
                type="text"
                inputmode="numeric"
                value={pin()}
                onInput={(e) => setPin(e.currentTarget.value)}
                placeholder="123456"
                class="w-full px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-md text-[var(--color-text-primary)] font-mono text-lg tracking-widest"
                disabled={status() === "pairing"}
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
                your name (shown on the player)
              </label>
              <input
                type="text"
                value={controllerName()}
                onInput={(e) => setControllerName(e.currentTarget.value)}
                class="w-full px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-md text-[var(--color-text-primary)] text-sm"
                disabled={status() === "pairing"}
              />
            </div>

            <Show when={status() === "error"}>
              <div class="p-3 bg-[var(--color-status-error)]/10 border border-[var(--color-status-error)] rounded-md">
                <p class="text-sm text-[var(--color-status-error)]">{errorMessage()}</p>
              </div>
            </Show>

            <Button type="submit" disabled={status() === "pairing"} class="w-full">
              {status() === "pairing" ? "pairing..." : "pair"}
            </Button>
          </form>
        </div>
      </div>
    </Show>
  );
}
