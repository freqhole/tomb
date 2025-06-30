import { createSignal } from "solid-js";

export interface UseResizeProps {
  initialWidth: number;
  minWidth?: number;
  maxWidth?: number;
  closeThreshold?: number;
  onWidthChange?: (width: number) => void;
  onClose?: () => void;
}

export function useResize(props: UseResizeProps) {
  const [width, setWidth] = createSignal(props.initialWidth);
  const [isDragging, setIsDragging] = createSignal(false);

  const minWidth = props.minWidth || 250;
  const maxWidth = props.maxWidth || 600;
  const closeThreshold = props.closeThreshold || 100;

  const handleMouseDown = (
    e: MouseEvent,
    direction: "left" | "right" = "right"
  ) => {
    e.preventDefault();
    setIsDragging(true);
    document.body.classList.add("resizing");

    const startX = e.clientX;
    const startWidth = width();

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX;

      // For right-side panels (filter panel), dragging left increases width
      // For left-side panels (browse panel), dragging right increases width
      const calculatedWidth =
        direction === "right" ? startWidth - deltaX : startWidth + deltaX;

      // Check if we should close the panel
      if (calculatedWidth < closeThreshold) {
        props.onClose?.();
        return;
      }

      const newWidth = Math.max(minWidth, Math.min(maxWidth, calculatedWidth));
      setWidth(newWidth);
      props.onWidthChange?.(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.classList.remove("resizing");
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  return {
    width,
    setWidth,
    isDragging,
    handleMouseDown,
  };
}
