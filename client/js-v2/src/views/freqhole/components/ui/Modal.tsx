import { JSX, Show, createSignal, onMount, onCleanup } from "solid-js";
import { useGlobalOverlay } from "./useGlobalOverlay";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: JSX.Element;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  showCloseButton?: boolean;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
}

export interface PopoverProps {
  isOpen: boolean;
  onClose: () => void;
  anchorElement?: HTMLElement;
  children: JSX.Element;
  placement?: "top" | "bottom" | "left" | "right" | "auto";
  offset?: number;
  showArrow?: boolean;
}

// Modal Component
export function Modal(props: ModalProps) {
  const [modalRef, setModalRef] = createSignal<HTMLDivElement>();
  const overlay = useGlobalOverlay("modal");

  const size = () => props.size || "md";
  const showCloseButton = () => props.showCloseButton ?? true;

  const sizeClasses = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
    full: "max-w-[95vw] max-h-[95vh]",
  };

  onMount(() => {
    if (props.isOpen && modalRef()) {
      // Activate this overlay in the global system
      overlay.activate(modalRef()!, props.onClose);
      // Prevent body scroll when modal is open
      document.body.style.overflow = "hidden";
    } else if (!props.isOpen) {
      overlay.deactivate();
      document.body.style.overflow = "";
    }

    onCleanup(() => {
      overlay.deactivate();
      document.body.style.overflow = "";
    });
  });

  return (
    <Show when={props.isOpen}>
      {/* Backdrop */}
      <div class="fixed inset-0 z-50 bg-black bg-opacity-60 backdrop-blur-sm flex items-center justify-center p-4 metro-fade-in">
        {/* Modal */}
        <div
          ref={(el) => {
            setModalRef(el);
            if (el && props.isOpen) {
              overlay.activate(el, props.onClose);
              document.body.style.overflow = "hidden";
            }
          }}
          class={`bg-black border border-dark-300 shadow-2xl w-full ${
            sizeClasses[size()]
          } max-h-[90vh] overflow-hidden metro-slide-up`}
        >
          {/* Header */}
          <Show when={props.title || showCloseButton()}>
            <div class="flex items-center justify-between p-6 border-b border-dark-300">
              <Show when={props.title}>
                <h2 class="text-xl font-semibold text-white">{props.title}</h2>
              </Show>
              <Show when={showCloseButton()}>
                <button
                  onClick={props.onClose}
                  class="p-2 border border-transparent hover:bg-primary-500 hover:border-primary-300 transition-all duration-200 metro-button-hover"
                  aria-label="Close modal"
                >
                  <svg
                    class="w-5 h-5 text-gray-400 hover:text-white"
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
              </Show>
            </div>
          </Show>

          {/* Content */}
          <div class="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
            {props.children}
          </div>
        </div>
      </div>
    </Show>
  );
}

// Popover Component
export function Popover(props: PopoverProps) {
  const [popoverRef, setPopoverRef] = createSignal<HTMLDivElement>();
  const [position, setPosition] = createSignal({ x: 0, y: 0 });
  const [actualPlacement, setActualPlacement] = createSignal<string>("bottom");
  const overlay = useGlobalOverlay("popover");

  const offset = () => props.offset || 8;
  const placement = () => props.placement || "auto";

  const calculatePosition = () => {
    const popover = popoverRef();
    const anchor = props.anchorElement;

    if (!popover || !anchor) return;

    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = 0;
    let y = 0;
    let finalPlacement = placement();

    // Auto placement - find best position
    if (placement() === "auto") {
      const spaceBottom = viewportHeight - anchorRect.bottom;
      const spaceTop = anchorRect.top;
      const spaceRight = viewportWidth - anchorRect.right;
      const spaceLeft = anchorRect.left;

      if (spaceBottom >= popoverRect.height + offset()) {
        finalPlacement = "bottom";
      } else if (spaceTop >= popoverRect.height + offset()) {
        finalPlacement = "top";
      } else if (spaceRight >= popoverRect.width + offset()) {
        finalPlacement = "right";
      } else if (spaceLeft >= popoverRect.width + offset()) {
        finalPlacement = "left";
      } else {
        finalPlacement = "bottom"; // Default fallback
      }
    }

    // Calculate position based on placement
    switch (finalPlacement) {
      case "top":
        x = anchorRect.left + anchorRect.width / 2 - popoverRect.width / 2;
        y = anchorRect.top - popoverRect.height - offset();
        break;
      case "bottom":
        x = anchorRect.left + anchorRect.width / 2 - popoverRect.width / 2;
        y = anchorRect.bottom + offset();
        break;
      case "left":
        x = anchorRect.left - popoverRect.width - offset();
        y = anchorRect.top + anchorRect.height / 2 - popoverRect.height / 2;
        break;
      case "right":
        x = anchorRect.right + offset();
        y = anchorRect.top + anchorRect.height / 2 - popoverRect.height / 2;
        break;
    }

    // Constrain to viewport
    if (x + popoverRect.width > viewportWidth - 10) {
      x = viewportWidth - popoverRect.width - 10;
    }
    if (x < 10) {
      x = 10;
    }
    if (y + popoverRect.height > viewportHeight - 10) {
      y = viewportHeight - popoverRect.height - 10;
    }
    if (y < 10) {
      y = 10;
    }

    setPosition({ x, y });
    setActualPlacement(finalPlacement);
  };

  onMount(() => {
    if (props.isOpen && popoverRef()) {
      // Activate this overlay in the global system
      overlay.activate(popoverRef()!, props.onClose);
      // Calculate initial position
      requestAnimationFrame(() => {
        calculatePosition();
      });
    } else if (!props.isOpen) {
      overlay.deactivate();
    }

    // Still need resize/scroll listeners for positioning
    window.addEventListener("resize", calculatePosition);
    window.addEventListener("scroll", calculatePosition);

    onCleanup(() => {
      overlay.deactivate();
      window.removeEventListener("resize", calculatePosition);
      window.removeEventListener("scroll", calculatePosition);
    });
  });

  return (
    <Show when={props.isOpen}>
      <div
        ref={(el) => {
          setPopoverRef(el);
          if (el && props.isOpen) {
            overlay.activate(el, props.onClose);
            requestAnimationFrame(() => {
              calculatePosition();
            });
          }
        }}
        class="fixed z-50 bg-dark-200 border border-dark-300 shadow-xl min-w-48 metro-slide-up"
        style={{
          left: `${position().x}px`,
          top: `${position().y}px`,
        }}
      >
        {/* Arrow */}
        <Show when={props.showArrow}>
          <div
            class={`absolute w-3 h-3 bg-dark-200 border border-dark-300 rotate-45 ${
              actualPlacement() === "top"
                ? "bottom-[-7px] left-1/2 transform -translate-x-1/2 border-t-0 border-l-0"
                : actualPlacement() === "bottom"
                  ? "top-[-7px] left-1/2 transform -translate-x-1/2 border-b-0 border-r-0"
                  : actualPlacement() === "left"
                    ? "right-[-7px] top-1/2 transform -translate-y-1/2 border-l-0 border-b-0"
                    : "left-[-7px] top-1/2 transform -translate-y-1/2 border-r-0 border-t-0"
            }`}
          />
        </Show>

        {/* Content */}
        <div class="p-4">{props.children}</div>
      </div>
    </Show>
  );
}

// Hooks for managing modal/popover state
export function useModal() {
  const [isOpen, setIsOpen] = createSignal(false);

  const open = () => setIsOpen(true);
  const close = () => setIsOpen(false);
  const toggle = () => setIsOpen(!isOpen());

  return {
    isOpen,
    open,
    close,
    toggle,
  };
}

export function usePopover() {
  const [isOpen, setIsOpen] = createSignal(false);
  const [anchorElement, setAnchorElement] = createSignal<HTMLElement>();

  const open = (element?: HTMLElement) => {
    if (element) {
      setAnchorElement(element);
    }
    setIsOpen(true);
  };

  const close = () => setIsOpen(false);

  const toggle = (element?: HTMLElement) => {
    if (isOpen()) {
      close();
    } else {
      open(element);
    }
  };

  const handleButtonClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    toggle(event.currentTarget as HTMLElement);
  };

  return {
    isOpen,
    anchorElement,
    open,
    close,
    toggle,
    handleButtonClick,
  };
}
