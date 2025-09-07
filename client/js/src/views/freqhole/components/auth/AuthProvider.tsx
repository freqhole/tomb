import { createEffect, ParentComponent, JSX } from "solid-js";
import { useAuth } from "../../../../hooks/auth";

export interface AuthProviderProps {
  children: JSX.Element;
}

export const AuthProvider: ParentComponent<AuthProviderProps> = (props) => {
  const auth = useAuth();

  // Check auth status when the component mounts
  createEffect(() => {
    auth.checkAuthStatus().catch((err) => {
      console.warn("Failed to check auth status on app load:", err);
    });
  });

  return <>{props.children}</>;
};
