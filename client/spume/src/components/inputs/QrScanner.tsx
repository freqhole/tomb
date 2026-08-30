// QR code scanner component using the qr-scanner library
// camera-based QR code scanning for browser environments
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import QrScannerLib from "qr-scanner";
import { debug } from "../../utils/logger";
import "./QrScanner.css";

export interface QrScannerProps {
  onResult: (text: string) => void;
  onError?: (error: string) => void;
  onClose: () => void;
}

// extract node_id or peer_addr from various formats:
// - bare 64-char hex node_id
// - full URL like spume.freqhole.net/?r=<node_id>
// - URL like https://spume.freqhole.net?r=<node_id>
function extractPeerValue(text: string): string {
  const trimmed = text.trim();

  // check if it's a URL with ?r= param
  try {
    const url = new URL(trimmed);
    const rParam = url.searchParams.get("r");
    if (rParam) {
      debug("QrScanner", `extracted node_id from URL param: ${rParam.slice(0, 16)}...`);
      return rParam;
    }
  } catch {
    // not a URL, continue
  }

  // check if it's a URL without scheme (like spume.freqhole.net/?r=abc)
  if (trimmed.includes("?r=")) {
    const match = trimmed.match(/[?&]r=([a-fA-F0-9]{64})/);
    if (match) {
      debug("QrScanner", `extracted node_id from query string: ${match[1].slice(0, 16)}...`);
      return match[1];
    }
  }

  // return as-is (might be bare node_id or JSON)
  return trimmed;
}

export function QrScanner(props: QrScannerProps) {
  const [error, setError] = createSignal<string | null>(null);
  let scanner: QrScannerLib | null = null;
  let isScanning = false;
  let videoRef: HTMLVideoElement | undefined;

  const startScanner = async () => {
    if (!videoRef) return;

    const handleDecode = (result: QrScannerLib.ScanResult) => {
      const decodedText = result.data;
      debug("QrScanner", `scanned: ${decodedText.slice(0, 50)}...`);
      const peerValue = extractPeerValue(decodedText);
      // stop fully BEFORE calling back — `onResult` triggers the
      // parent to unmount this component practically synchronously,
      // which also fires this component's own `onCleanup` ->
      // `stopScanner()` a second time. tearing down the scanner
      // first means that follow-up call is a safe no-op (guarded
      // by `isScanning`).
      stopScanner();
      props.onResult(peerValue);
    };

    const handleDecodeError = () => {
      // scan error (no QR found in frame) - ignore
    };

    try {
      setError(null);
      scanner = new QrScannerLib(videoRef, handleDecode, {
        preferredCamera: "environment",
        highlightScanRegion: true,
        highlightCodeOutline: true,
        returnDetailedScanResult: true,
        onDecodeError: handleDecodeError,
      });

      // the player pairing qr renders magenta modules on a black
      // background — inverted polarity from the dark-on-light
      // convention this library assumes by default for webcam scans
      // ("original" mode only). "both" tries each frame both ways, so
      // bright-on-dark codes decode too without changing their colors.
      scanner.setInversionMode("both");

      await scanner.start();
      isScanning = true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      // map common browser/webview errors to friendlier messages.
      // android webview surfaces a denied getUserMedia as NotAllowedError.
      let friendly = errorMsg;
      const lower = errorMsg.toLowerCase();
      if (
        lower.includes("notallowed") ||
        lower.includes("permission") ||
        lower.includes("denied")
      ) {
        friendly =
          "camera permission denied — enable camera access for freqhole in your device settings and try again";
      } else if (lower.includes("notfound") || lower.includes("no camera")) {
        friendly = "no camera found on this device";
      } else if (lower.includes("notreadable") || lower.includes("in use")) {
        friendly = "camera is in use by another app";
      }
      setError(friendly);
      props.onError?.(friendly);
      debug("QrScanner", `error starting scanner: ${errorMsg}`);
    }
  };

  const stopScanner = () => {
    if (scanner && isScanning) {
      scanner.stop();
      scanner.destroy();
      scanner = null;
      isScanning = false;
    }
  };

  onMount(() => {
    // check for camera support
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("camera not available in this browser");
      return;
    }

    void startScanner();
  });

  onCleanup(() => {
    stopScanner();
  });

  const handleClose = () => {
    stopScanner();
    props.onClose();
  };

  return (
    <div class="qr-scanner-overlay">
      <div class="qr-scanner-container">
        <div class="qr-scanner-header">
          <span>scan QR code</span>
          <button type="button" class="qr-scanner-close" onClick={handleClose}>
            ✕
          </button>
        </div>

        <Show
          when={!error()}
          fallback={
            <div class="qr-scanner-error">
              <p>{error()}</p>
              <button type="button" onClick={() => void startScanner()}>
                try again
              </button>
            </div>
          }
        >
          <video ref={videoRef} class="qr-scanner-reader" muted playsinline />
        </Show>

        <div class="qr-scanner-hint">
          <p>point camera at a QR code to scan</p>
        </div>
      </div>
    </div>
  );
}
