import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AuthForm } from "../src/components/auth/AuthForm";

const meta = {
  title: "Components/Auth/AuthForm",
  component: AuthForm,
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
} satisfies Meta<typeof AuthForm>;

export default meta;
type Story = StoryObj<typeof meta>;

// full authentication flow
export const FullFlow: Story = {
  render: () => {
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal<string | undefined>(undefined);
    const [mode, setMode] = createSignal<"login" | "register">("login");
    const [isAuthenticated, setIsAuthenticated] = createSignal(false);
    const [authenticatedUser, setAuthenticatedUser] = createSignal("");

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
      setAuthenticatedUser(data.username);
      setIsAuthenticated(true);
      setLoading(false);
    };

    const handleLogout = () => {
      setIsAuthenticated(false);
      setAuthenticatedUser("");
      setError(undefined);
    };

    return (
      <div class="max-w-md space-y-4">
        {isAuthenticated() ? (
          <div class="space-y-4">
            <div class="p-6 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded">
              <div class="body-sm text-[var(--color-text-secondary)] mb-2">
                authenticated as:
              </div>
              <div class="heading-md text-[var(--color-accent-500)]">
                {authenticatedUser()}
              </div>
            </div>
            <button
              onClick={handleLogout}
              class="w-full py-2 px-4 bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] rounded transition-colors"
            >
              sign out
            </button>
          </div>
        ) : (
          <div class="space-y-4">
            <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded">
              <div class="caption text-[var(--color-text-muted)]">
                demo hint: use invite code{" "}
                <code class="text-[var(--color-accent-500)]">FREQHOLE2024</code>{" "}
                to register
              </div>
            </div>
            <AuthForm
              initialMode={mode()}
              loading={loading()}
              error={error()}
              onSubmit={handleSubmit}
              onModeChange={setMode}
            />
          </div>
        )}
      </div>
    );
  },
};

// login mode
export const Login: Story = {
  args: {
    initialMode: "login",
    onSubmit: (data) => {
      console.log("login submitted:", data);
    },
  },
};

// register mode
export const Register: Story = {
  args: {
    initialMode: "register",
    onSubmit: (data) => {
      console.log("register submitted:", data);
    },
  },
};

// with error message
export const WithError: Story = {
  args: {
    initialMode: "login",
    error: "invalid username or authentication failed",
    onSubmit: (data) => {
      console.log("login submitted:", data);
    },
  },
};

// loading state
export const Loading: Story = {
  args: {
    initialMode: "login",
    loading: true,
    onSubmit: (data) => {
      console.log("login submitted:", data);
    },
  },
};

// without mode toggle
export const WithoutModeToggle: Story = {
  args: {
    initialMode: "login",
    showModeToggle: false,
    onSubmit: (data) => {
      console.log("login submitted:", data);
    },
  },
};

// interactive example with state management
export const Interactive: Story = {
  render: () => {
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal<string | undefined>(undefined);
    const [mode, setMode] = createSignal<"login" | "register">("login");

    const handleSubmit = async (data: {
      username: string;
      inviteCode?: string;
      mode: "login" | "register";
    }) => {
      setLoading(true);
      setError(undefined);

      // simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // simulate random success/failure
      if (Math.random() > 0.3) {
        console.log("auth successful:", data);
        setLoading(false);
        alert(`${data.mode} successful for ${data.username}!`);
      } else {
        setError(
          data.mode === "login"
            ? "authentication failed - please try again"
            : "invalid invite code or username already taken",
        );
        setLoading(false);
      }
    };

    return (
      <div class="max-w-md">
        <AuthForm
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

// side by side comparison
export const SideBySide: Story = {
  render: () => (
    <div class="grid grid-cols-2 gap-8">
      <div>
        <div class="label text-[var(--color-text-secondary)] mb-4">
          login mode
        </div>
        <AuthForm
          initialMode="login"
          showModeToggle={false}
          onSubmit={(data) => console.log("login:", data)}
        />
      </div>
      <div>
        <div class="label text-[var(--color-text-secondary)] mb-4">
          register mode
        </div>
        <AuthForm
          initialMode="register"
          showModeToggle={false}
          onSubmit={(data) => console.log("register:", data)}
        />
      </div>
    </div>
  ),
};

// register with error
export const RegisterWithError: Story = {
  args: {
    initialMode: "register",
    error: "this invite code has already been used",
    onSubmit: (data) => {
      console.log("register submitted:", data);
    },
  },
};

// loading register
export const LoadingRegister: Story = {
  args: {
    initialMode: "register",
    loading: true,
    onSubmit: (data) => {
      console.log("register submitted:", data);
    },
  },
};
