// QR code scanner component using html5-qrcode library
// camera-based QR code scanning for browser environments
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
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
  const [isScanning, setIsScanning] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let scanner: Html5Qrcode | null = null;
  let containerRef: HTMLDivElement | undefined;

  const startScanner = async () => {
    if (!containerRef) return;

    try {
      setError(null);
      scanner = new Html5Qrcode("qr-reader", {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        // ios safari 17+ ships a native BarcodeDetector that's
        // dramatically more reliable than the wasm fallback.
        // html5-qrcode only uses it when we opt in here.
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true,
        },
        verbose: false,
      });

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          // size the scan region as a fraction of the live
          // viewfinder rather than a fixed 250x250 box. on
          // iphone the rear camera streams at >=1280x720, so a
          // hard-coded 250px box only covers ~20% of the frame
          // and most hand-held qr codes never land in it. a
          // responsive box (~70% of the shorter side, capped at
          // 320) consistently catches the spume invite qrs.
          qrbox: (viewW: number, viewH: number) => {
            const min = Math.min(viewW, viewH);
            const size = Math.max(180, Math.min(320, Math.floor(min * 0.7)));
            return { width: size, height: size };
          },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          debug("QrScanner", `scanned: ${decodedText.slice(0, 50)}...`);
          const peerValue = extractPeerValue(decodedText);
          stopScanner();
          props.onResult(peerValue);
        },
        () => {
          // scan error (no QR found) - ignore
        }
      );

      setIsScanning(true);
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

  const stopScanner = async () => {
    if (scanner && isScanning()) {
      try {
        await scanner.stop();
      } catch {
        // ignore stop errors
      }
      setIsScanning(false);
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
    void stopScanner();
  });

  const handleClose = () => {
    void stopScanner();
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
          <div id="qr-reader" ref={containerRef} class="qr-scanner-reader" />
        </Show>

        <div class="qr-scanner-hint">
          <p>point camera at a QR code to scan</p>
        </div>
      </div>
    </div>
  );
}
