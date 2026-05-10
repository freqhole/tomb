// reusable qr code modal — renders a qr image for an arbitrary string
// (typically a share url like https://spume.freqhole.net?r=<node_id>).
import { Show, createEffect, createSignal } from "solid-js";
import QRCode from "qrcode";
import { Modal } from "../overlays/Modal";
import { CopyButton } from "../buttons/CopyButton";

export interface QrCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** the string to encode in the qr (usually a url) */
  payload: string;
  /** optional title shown in the modal header */
  title?: string;
  /** optional subtitle/description shown above the qr */
  subtitle?: string;
}

export function QrCodeModal(props: QrCodeModalProps) {
  const [dataUrl, setDataUrl] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    if (!props.isOpen || !props.payload) {
      setDataUrl(null);
      setError(null);
      return;
    }
    setError(null);
    QRCode.toDataURL(props.payload, {
      width: 320,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then(setDataUrl)
      .catch((e: unknown) => {
        console.error("qr generate failed:", e);
        setError("failed to generate qr code");
      });
  });

  return (
    <Modal isOpen={props.isOpen} onClose={props.onClose} title={props.title ?? "qr code"} size="sm">
      <div class="flex flex-col items-center gap-4">
        <Show when={props.subtitle}>
          <p class="text-sm text-[var(--color-text-secondary)] text-center">{props.subtitle}</p>
        </Show>
        <Show
          when={dataUrl()}
          fallback={
            <div class="text-sm text-[var(--color-text-muted)]">{error() ?? "generating..."}</div>
          }
        >
          <img
            src={dataUrl()!}
            alt="qr code"
            class="rounded bg-white p-3"
            width={320}
            height={320}
          />
        </Show>
        <div class="w-full flex items-center gap-2">
          <code class="flex-1 break-all rounded bg-[var(--color-bg-tertiary)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
            {props.payload}
          </code>
          <CopyButton text={props.payload} label="copy" copiedLabel="copied!" title="copy link" />
        </div>
      </div>
    </Modal>
  );
}
