// @vitest-environment jsdom
import { render } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

vi.mock("./dialogSupport", () => ({
  DIALOG_RESET_STYLE: {},
  registerDialogPolyfill: (dialog: HTMLDialogElement) => {
    dialog.showModal = () => {
      dialog.open = true;
    };
    dialog.close = () => {
      dialog.open = false;
    };
  },
}));
vi.mock("../buttons/IconButton", () => ({ IconButton: () => null }));

let dispose: (() => void) | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
  vi.restoreAllMocks();
});

it("closes on the viewport-sized backdrop, but not when clicking modal content", () => {
  const onClose = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <Modal isOpen onClose={onClose}>
        modal content
      </Modal>
    ),
    host
  );
  const dialog = host.querySelector("dialog")!;
  dialog.querySelector("div")!.click();
  expect(onClose).not.toHaveBeenCalled();
  dialog.click();
  expect(onClose).toHaveBeenCalledOnce();
});
