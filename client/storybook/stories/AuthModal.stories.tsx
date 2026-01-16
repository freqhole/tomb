import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AuthModal } from "../src/components/auth/AuthModal";
import { Button } from "../src/components/buttons/Button";

const meta = {
  title: "Components/Auth/AuthModal",
  component: AuthModal,
  tags: ["autodocs"],
  argTypes: {
    initialMode: {
      control: "select",
      options: ["login", "register"],
      description: "initial authentication mode",
    },
    loading: {
      control: "boolean",
      description: "loading state",
    },
    showModeToggle: {
      control: "boolean",
      description: "whether to show mode toggle",
    },
  },
} satisfies Meta<typeof AuthModal>;

export default meta;
type Story = StoryObj<typeof meta>;

// interactive with full flow
export const InteractiveFlow: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(false);
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal<string | undefined>(undefined);
    const [mode, setMode] = createSignal<"login" | "register">("login");
    const [isAuthenticated, setIsAuthenticated] = createSignal(false);
    const [username, setUsername] = createSignal("");

    const handleSubmit = async (data: {
      username: string;
      inviteCode?: string;
      mode: "login" | "register";
    }) => {
      setLoading(true);
      setError(undefined);

      // simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // simulate validation
      if (data.mode === "register" && data.inviteCode !== "FREQHOLE2024") {
        setError("invalid invite code");
        setLoading(false);
        return;
      }

      if (!data.username || data.username.length < 3) {
        setError("username must be at least 3 characters");
        setLoading(false);
        return;
      }

      // success
      setUsername(data.username);
      setIsAuthenticated(true);
      setLoading(false);
      setIsOpen(false);
    };

    const handleLogout = () => {
      setIsAuthenticated(false);
      setUsername("");
      setError(undefined);
      setMode("login");
    };

    return (
      <div class="space-y-4">
        <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded">
          <div class="caption text-[var(--color-text-muted)] mb-2">
            demo hint: use invite code{" "}
            <code class="text-[var(--color-accent-500)]">FREQHOLE2024</code> to
            register
          </div>
        </div>

        {isAuthenticated() ? (
          <div class="space-y-4">
            <div class="p-6 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded">
              <div class="body-sm text-[var(--color-text-secondary)] mb-2">
                authenticated as:
              </div>
              <div class="heading-md text-[var(--color-accent-500)]">
                {username()}
              </div>
            </div>
            <Button onClick={handleLogout} variant="ghost">
              sign out
            </Button>
          </div>
        ) : (
          <Button onClick={() => setIsOpen(true)} variant="primary">
            sign in / register
          </Button>
        )}

        <AuthModal
          isOpen={isOpen()}
          onClose={() => {
            setIsOpen(false);
            setError(undefined);
          }}
          initialMode={mode()}
          loading={loading()}
          error={error()}
          onSubmit={handleSubmit}
          onModeChange={setMode}
        />
      </div>
    );
  },
};

// basic login modal
export const LoginModal: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(false);

    return (
      <div>
        <Button onClick={() => setIsOpen(true)}>open login modal</Button>
        <AuthModal
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          initialMode="login"
          onSubmit={(data) => {
            console.log("login submitted:", data);
            setIsOpen(false);
          }}
        />
      </div>
    );
  },
};

// register modal
export const RegisterModal: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(false);

    return (
      <div>
        <Button onClick={() => setIsOpen(true)}>open register modal</Button>
        <AuthModal
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          initialMode="register"
          onSubmit={(data) => {
            console.log("register submitted:", data);
            setIsOpen(false);
          }}
        />
      </div>
    );
  },
};

// with error state
export const WithError: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(false);

    return (
      <div>
        <Button onClick={() => setIsOpen(true)} variant="danger">
          open modal with error
        </Button>
        <AuthModal
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          initialMode="login"
          error="authentication failed - please try again"
          onSubmit={(data) => console.log("login submitted:", data)}
        />
      </div>
    );
  },
};

// loading state
export const LoadingState: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(false);

    return (
      <div>
        <Button onClick={() => setIsOpen(true)}>open loading modal</Button>
        <AuthModal
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          initialMode="login"
          loading={true}
          onSubmit={(data) => console.log("login submitted:", data)}
        />
      </div>
    );
  },
};

// without mode toggle
export const WithoutModeToggle: Story = {
  render: () => {
    const [isOpen, setIsOpen] = createSignal(false);

    return (
      <div>
        <Button onClick={() => setIsOpen(true)}>open login-only modal</Button>
        <AuthModal
          isOpen={isOpen()}
          onClose={() => setIsOpen(false)}
          initialMode="login"
          showModeToggle={false}
          onSubmit={(data) => {
            console.log("login submitted:", data);
            setIsOpen(false);
          }}
        />
      </div>
    );
  },
};

// both modals side by side
export const SideBySide: Story = {
  render: () => {
    const [loginOpen, setLoginOpen] = createSignal(false);
    const [registerOpen, setRegisterOpen] = createSignal(false);

    return (
      <div class="flex gap-4">
        <Button onClick={() => setLoginOpen(true)}>open login</Button>
        <Button onClick={() => setRegisterOpen(true)} variant="primary">
          open register
        </Button>

        <AuthModal
          isOpen={loginOpen()}
          onClose={() => setLoginOpen(false)}
          initialMode="login"
          showModeToggle={false}
          onSubmit={(data) => {
            console.log("login:", data);
            setLoginOpen(false);
          }}
        />

        <AuthModal
          isOpen={registerOpen()}
          onClose={() => setRegisterOpen(false)}
          initialMode="register"
          showModeToggle={false}
          onSubmit={(data) => {
            console.log("register:", data);
            setRegisterOpen(false);
          }}
        />
      </div>
    );
  },
};
