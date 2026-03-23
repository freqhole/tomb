import { createSignal, createEffect, Show } from "solid-js";
import QRCode from "qrcode";
import "./QrCodeDisplay.css";

interface QrCodeDisplayProps {
  nodeId: string;
}

export function QrCodeDisplay(props: QrCodeDisplayProps) {
  const [showQr, setShowQr] = createSignal(false);
  const [includeUrl, setIncludeUrl] = createSignal(true);
  const [customValue, setCustomValue] = createSignal("");
  const [qrDataUrl, setQrDataUrl] = createSignal<string | null>(null);

  // compute the QR value based on toggle and custom input
  const qrValue = () => {
    const custom = customValue().trim();
    if (custom) return custom;
    if (includeUrl()) {
      return `https://spume.freqhole.net/?r=${props.nodeId}`;
    }
    return props.nodeId;
  };

  // generate QR code when value changes
  createEffect(() => {
    const value = qrValue();
    if (!showQr() || !value) {
      setQrDataUrl(null);
      return;
    }

    QRCode.toDataURL(value, {
      width: 200,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch((err) => {
        console.error("failed to generate QR code:", err);
        setQrDataUrl(null);
      });
  });

  // reset custom value when closing
  createEffect(() => {
    if (!showQr()) {
      setCustomValue("");
    }
  });

  return (
    <>
      <button class="secondary small" onClick={() => setShowQr(!showQr())}>
        {showQr() ? "hide qr" : "qr code"}
      </button>

      <Show when={showQr()}>
        <div class="qr-display">
          <div class="qr-controls">
            <button
              class={`qr-toggle ${includeUrl() ? "active" : ""}`}
              onClick={() => {
                setIncludeUrl(!includeUrl());
                setCustomValue(""); // reset custom when toggling
              }}
              title={includeUrl() ? "show node id only" : "include spume url"}
            >
              {includeUrl() ? "url" : "id"}
            </button>
            <input
              type="text"
              value={customValue() || qrValue()}
              onInput={(e) => setCustomValue(e.currentTarget.value)}
              class="qr-input"
              placeholder="node id or url"
            />
          </div>
          <Show
            when={qrDataUrl()}
            fallback={<div class="qr-loading">generating...</div>}
          >
            <img src={qrDataUrl()!} alt="QR Code" class="qr-image" />
          </Show>
        </div>
      </Show>
    </>
  );
}
