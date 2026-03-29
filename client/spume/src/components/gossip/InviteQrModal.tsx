// modal overlay that displays a QR code for a gossip channel invite URL
import { createSignal, onMount, Show } from "solid-js";
import QRCode from "qrcode";

export interface InviteQrModalProps {
  url: string;
  channelName: string;
  onClose: () => void;
}

export function InviteQrModal(props: InviteQrModalProps) {
  const [qrDataUrl, setQrDataUrl] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);

  onMount(async () => {
    try {
      const dataUrl = await QRCode.toDataURL(props.url, {
        width: 256,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      });
      setQrDataUrl(dataUrl);
    } catch {
      // qrcode generation failed — url will still be visible
    }
  });

  const handleCopy = async () => {
    await navigator.clipboard.writeText(props.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div class="bg-[var(--color-bg-elevated)] rounded-xl p-5 w-full max-w-xs shadow-xl flex flex-col items-center gap-4">
        <h2 class="text-sm font-semibold text-[var(--color-text-primary)]">
          invite to {props.channelName}
        </h2>

        <Show
          when={qrDataUrl()}
          fallback={
            <div class="w-64 h-64 flex items-center justify-center text-xs text-[var(--color-text-tertiary)]">
              generating QR...
            </div>
          }
        >
          {(dataUrl) => <img src={dataUrl()} alt="invite QR code" class="w-64 h-64 rounded-lg" />}
        </Show>

        <p class="text-[10px] text-[var(--color-text-tertiary)] text-center break-all max-w-full px-2">
          {props.url}
        </p>

        <div class="flex gap-2 w-full">
          <button
            class="flex-1 px-3 py-2 text-xs font-medium rounded-lg bg-[var(--color-accent-500)] text-[var(--color-text-on-accent)] hover:bg-[var(--color-accent-400)] transition-colors"
            onClick={handleCopy}
          >
            {copied() ? "copied!" : "copy link"}
          </button>
          <button
            class="px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-colors"
            onClick={() => props.onClose()}
          >
            close
          </button>
        </div>
      </div>
    </div>
  );
}
