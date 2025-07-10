/* @jsxImportSource solid-js */
import { createMemo } from "solid-js";
import { ApiClient, ApiError } from "../../lib/api-client.js";
import { createStore } from "solid-js/store";

// WebAuthn types
type UserVerificationRequirement = "required" | "preferred" | "discouraged";

// Base64 utility functions for WebAuthn
const base64ToUint8Array = (base64: string): Uint8Array => {
  const binaryString = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const uint8ArrayToBase64 = (uint8Array: Uint8Array): string => {
  let binaryString = "";
  for (let i = 0; i < uint8Array.length; i++) {
    binaryString += String.fromCharCode(uint8Array[i]!);
  }
  return btoa(binaryString)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
};

export interface AuthState {
  isAuthenticated: boolean;
  currentUser: string | null;
  isLoading: boolean;
  error: string | null;
}

export interface AuthActions {
  checkAuthStatus: () => Promise<boolean>;
  login: (username: string) => Promise<void>;
  register: (username: string, inviteCode: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export interface UseAuthOptions {
  baseUrl?: string;
  onAuthSuccess?: (username: string) => void;
  onAuthError?: (error: string) => void;
  onLogout?: () => void;
}

// Global auth store (shared across all components)
const [authStore, setAuthStore] = createStore({
  isAuthenticated: false,
  currentUser: null as string | null,
  isLoading: false,
  error: null as string | null,
});

export const useAuth = (options: UseAuthOptions = {}) => {
  // API client
  const apiClient = createMemo(
    () =>
      new ApiClient({
        baseUrl: options.baseUrl || "http://localhost:8080",
      })
  );

  const handleError = (err: unknown) => {
    const errorMessage =
      err instanceof ApiError
        ? `${err.message} (${err.status})`
        : err instanceof Error
          ? err.message
          : "An unknown error occurred";

    setAuthStore("error", errorMessage);
    options.onAuthError?.(errorMessage);
  };

  const clearError = () => {
    setAuthStore("error", null);
  };

  const resetLoadingState = () => {
    setAuthStore("isLoading", false);
  };

  const checkAuthStatus = async (): Promise<boolean> => {
    setAuthStore("isLoading", true);
    setAuthStore("error", null);

    try {
      const status = await apiClient().authStatus();
      setAuthStore("isAuthenticated", status.authenticated);
      setAuthStore("currentUser", status.username || null);
      return status.authenticated;
    } catch (err) {
      setAuthStore("isAuthenticated", false);
      setAuthStore("currentUser", null);
      return false;
    } finally {
      setAuthStore("isLoading", false);
    }
  };

  const checkAuthStatusSilent = async (): Promise<boolean> => {
    try {
      const status = await apiClient().authStatus();
      setAuthStore("isAuthenticated", status.authenticated);
      setAuthStore("currentUser", status.username || null);
      return status.authenticated;
    } catch (err) {
      setAuthStore("isAuthenticated", false);
      setAuthStore("currentUser", null);
      return false;
    }
  };

  const register = async (
    username: string,
    inviteCode: string
  ): Promise<void> => {
    if (!username || !inviteCode) {
      handleError(new Error("Please enter both username and invite code"));
      return;
    }

    setAuthStore("isLoading", true);
    setAuthStore("error", null);

    try {
      // Start registration
      const challenge = await apiClient().registerStart(username, {
        invite_code: inviteCode,
      });

      // Convert challenge data for WebAuthn API
      const credentialCreationOptions: CredentialCreationOptions = {
        publicKey: {
          ...challenge.publicKey,
          challenge: base64ToUint8Array(challenge.publicKey.challenge),
          attestation: challenge.publicKey
            .attestation as AttestationConveyancePreference,
          user: {
            ...challenge.publicKey.user,
            id: base64ToUint8Array(challenge.publicKey.user.id),
          },
          authenticatorSelection: {
            ...challenge.publicKey.authenticatorSelection,
            residentKey: challenge.publicKey.authenticatorSelection
              .residentKey as ResidentKeyRequirement,
            userVerification: challenge.publicKey.authenticatorSelection
              .userVerification as UserVerificationRequirement,
          },
          excludeCredentials: challenge.publicKey.excludeCredentials?.map(
            (cred) => ({
              ...cred,
              id: base64ToUint8Array(cred.id),
            })
          ),
          ...(challenge.publicKey.extensions && {
            extensions: challenge.publicKey.extensions,
          }),
        },
      };

      // Create credential
      const credential = (await navigator.credentials.create(
        credentialCreationOptions
      )) as PublicKeyCredential;

      if (!credential) {
        throw new Error("Failed to create credential");
      }

      // Finish registration
      await apiClient().registerFinish({
        id: credential.id,
        rawId: uint8ArrayToBase64(new Uint8Array(credential.rawId)),
        type: credential.type,
        response: {
          attestationObject: uint8ArrayToBase64(
            new Uint8Array(
              (
                credential.response as AuthenticatorAttestationResponse
              ).attestationObject
            )
          ),
          clientDataJSON: uint8ArrayToBase64(
            new Uint8Array(credential.response.clientDataJSON)
          ),
        },
      });

      await checkAuthStatus();
      options.onAuthSuccess?.(username);
    } catch (err) {
      handleError(err);
    } finally {
      setAuthStore("isLoading", false);
    }
  };

  const login = async (username: string): Promise<void> => {
    if (!username) {
      handleError(new Error("Please enter a username"));
      return;
    }

    setAuthStore("isLoading", true);
    setAuthStore("error", null);

    try {
      // Start login
      const challenge = await apiClient().loginStart(username);

      // Convert challenge data for WebAuthn API
      const credentialRequestOptions: CredentialRequestOptions = {
        publicKey: {
          ...challenge.publicKey,
          challenge: base64ToUint8Array(challenge.publicKey.challenge),
          userVerification: challenge.publicKey
            .userVerification as UserVerificationRequirement,
          allowCredentials: challenge.publicKey.allowCredentials?.map(
            (cred) => ({
              ...cred,
              id: base64ToUint8Array(cred.id),
            })
          ),
        },
      };

      // Get assertion
      const assertion = (await navigator.credentials.get(
        credentialRequestOptions
      )) as PublicKeyCredential;

      if (!assertion) {
        throw new Error("Failed to get assertion");
      }

      // Finish login
      await apiClient().loginFinish({
        id: assertion.id,
        rawId: uint8ArrayToBase64(new Uint8Array(assertion.rawId)),
        type: assertion.type,
        response: {
          authenticatorData: uint8ArrayToBase64(
            new Uint8Array(
              (
                assertion.response as AuthenticatorAssertionResponse
              ).authenticatorData
            )
          ),
          clientDataJSON: uint8ArrayToBase64(
            new Uint8Array(assertion.response.clientDataJSON)
          ),
          signature: uint8ArrayToBase64(
            new Uint8Array(
              (assertion.response as AuthenticatorAssertionResponse).signature
            )
          ),
          userHandle: (assertion.response as AuthenticatorAssertionResponse)
            .userHandle
            ? uint8ArrayToBase64(
                new Uint8Array(
                  (
                    assertion.response as AuthenticatorAssertionResponse
                  ).userHandle!
                )
              )
            : undefined,
        },
      });

      await checkAuthStatus();
      options.onAuthSuccess?.(username);
    } catch (err) {
      handleError(err);
    } finally {
      setAuthStore("isLoading", false);
    }
  };

  const logout = async (): Promise<void> => {
    setAuthStore("isLoading", true);
    setAuthStore("error", null);

    try {
      await apiClient().logout();
      setAuthStore("isAuthenticated", false);
      setAuthStore("currentUser", null);
      options.onLogout?.();
    } catch (err) {
      handleError(err);
    } finally {
      setAuthStore("isLoading", false);
    }
  };

  // Return store and actions directly
  return {
    // State as store properties (access directly)
    get isAuthenticated() {
      return authStore.isAuthenticated;
    },
    get currentUser() {
      return authStore.currentUser;
    },
    get isLoading() {
      return authStore.isLoading;
    },
    get error() {
      return authStore.error;
    },
    // Actions
    checkAuthStatus,
    checkAuthStatusSilent,
    login,
    register,
    logout,
    clearError,
    resetLoadingState,
  };
};
