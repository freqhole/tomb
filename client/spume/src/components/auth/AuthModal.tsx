import { Modal } from "../overlays/Modal";
import { AuthForm, type AuthFormProps } from "./AuthForm";

export interface AuthModalProps extends Omit<AuthFormProps, "class"> {
  /** whether the modal is open */
  isOpen: boolean;
  /** callback when modal is closed */
  onClose: () => void;
  /** callback when authentication succeeds */
  onAuthSuccess?: () => void;
}

// auth modal component wrapping AuthForm in a Modal
export function AuthModal(props: AuthModalProps) {
  const handleSubmit: AuthFormProps["onSubmit"] = async (data) => {
    await props.onSubmit?.(data);
    // if onAuthSuccess is provided, call it after successful submit
    // (in real usage, you'd only call this after the API confirms success)
    props.onAuthSuccess?.();
  };

  const title = () => ((props.initialMode || "login") === "login" ? "sign in" : "create account");

  return (
    <Modal isOpen={props.isOpen} onClose={props.onClose} title={title()}>
      <AuthForm
        initialMode={props.initialMode}
        onSubmit={handleSubmit}
        loading={props.loading}
        error={props.error}
        onModeChange={props.onModeChange}
        showModeToggle={props.showModeToggle}
      />
    </Modal>
  );
}
