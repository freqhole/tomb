// @vitest-environment jsdom
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

vi.mock("../overlays/Modal", () => ({
  Modal: (props: { children: JSX.Element }) => props.children,
}));
vi.mock("../icons/registry", () => ({ Icon: () => null }));

it.each([false, true])("keeps button order, styling, and actions consistent (local fallback: %s)", (localFallback) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const cancel = vi.fn();
  const confirm = vi.fn();
  const dispose = render(() => (
    <ConfirmDialog
      isOpen={true}
      onClose={cancel}
      onConfirm={confirm}
      message="stop listening and use your local queue?"
      confirmText="continue"
      variant={localFallback ? "secondary" : "danger"}
      cancelVariant={localFallback ? "danger" : undefined}
      cancelLast={localFallback}
    />
  ), host);
  try {
    const buttons = Array.from(host.querySelectorAll("button"));
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(
      localFallback ? ["continue", "cancel"] : ["cancel", "continue"]
    );
    const cancelButton = buttons.find((button) => button.textContent?.trim() === "cancel")!;
    const confirmButton = buttons.find((button) => button.textContent?.trim() === "continue")!;
    expect(cancelButton.classList.contains("bg-[var(--color-error)]")).toBe(localFallback);
    expect(confirmButton.classList.contains("bg-[var(--color-bg-elevated)]")).toBe(localFallback);
    expect(confirmButton.classList.contains("bg-[var(--color-error)]")).toBe(!localFallback);
    cancelButton.click();
    expect(cancel).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
    confirmButton.click();
    expect(confirm).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledTimes(2);
  } finally {
    dispose();
    host.remove();
  }
});
