import { z } from "zod";

// WebAuthn specific schemas
export const WebAuthnPublicKeyCredentialCreationOptionsSchema = z.object({
  challenge: z.string(),
  rp: z.object({
    id: z.string(),
    name: z.string(),
  }),
  user: z.object({
    id: z.string(),
    name: z.string(),
    displayName: z.string(),
  }),
  pubKeyCredParams: z.array(z.any()),
  timeout: z.number(),
  excludeCredentials: z.array(z.any()),
  authenticatorSelection: z.object({
    residentKey: z.string(),
    requireResidentKey: z.boolean(),
    userVerification: z.string(),
  }),
  attestation: z.string(),
  extensions: z.object({}).optional(),
});

export const WebAuthnPublicKeyCredentialRequestOptionsSchema = z.object({
  challenge: z.string(),
  timeout: z.number(),
  rpId: z.string(),
  allowCredentials: z.array(z.any()),
  userVerification: z.string(),
});

export const WebAuthnCredentialSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  response: z.object({
    attestationObject: z.string(),
    clientDataJSON: z.string(),
  }),
  type: z.string(),
});

export const WebAuthnAssertionSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  response: z.object({
    authenticatorData: z.string().optional(),
    clientDataJSON: z.string(),
    signature: z.string().optional(),
    userHandle: z.string().optional(),
  }),
  type: z.string(),
});

// API Specification - this describes all available routes and their schemas
export const API_SPEC = {
  baseUrl: "http://localhost:8080",
  endpoints: {
    registerStart: {
      method: "POST" as const,
      path: "/register_start/{username}",
      pathParams: ["username"] as const,
      queryParams: z.object({
        invite_code: z.string().optional(),
      }),
      requestSchema: z.void(),
      responseSchema: z.object({
        publicKey: WebAuthnPublicKeyCredentialCreationOptionsSchema,
      }),
    },
    registerFinish: {
      method: "POST" as const,
      path: "/register_finish",
      requestSchema: WebAuthnCredentialSchema,
      responseSchema: z
        .object({
          message: z.string().optional(),
        })
        .optional(),
    },
    loginStart: {
      method: "POST" as const,
      path: "/login_start/{username}",
      pathParams: ["username"] as const,
      requestSchema: z.void(),
      responseSchema: z.object({
        publicKey: WebAuthnPublicKeyCredentialRequestOptionsSchema,
      }),
    },
    loginFinish: {
      method: "POST" as const,
      path: "/login_finish",
      requestSchema: WebAuthnAssertionSchema,
      responseSchema: z
        .object({
          message: z.string().optional(),
        })
        .optional(),
    },
    logout: {
      method: "POST" as const,
      path: "/logout",
      requestSchema: z.void(),
      responseSchema: z
        .object({
          message: z.string().optional(),
        })
        .optional(),
    },
    health: {
      method: "GET" as const,
      path: "/health",
      requestSchema: z.void(),
      responseSchema: z.void(),
    },
    authStatus: {
      method: "GET" as const,
      path: "/api/whoami",
      requestSchema: z.void(),
      responseSchema: z.object({
        authenticated: z.boolean(),
        user_id: z.string().optional(),
        role: z.string().optional(),
        username: z.string().optional(),
      }),
    },
  },
} as const;

// Type helpers for working with the API spec
export type ApiSpec = typeof API_SPEC;
export type EndpointName = keyof ApiSpec["endpoints"];
export type EndpointConfig<T extends EndpointName> = ApiSpec["endpoints"][T];

// Inferred types from schemas
export type RegisterStartRequest = z.infer<
  typeof API_SPEC.endpoints.registerStart.requestSchema
>;
export type RegisterStartResponse = z.infer<
  typeof API_SPEC.endpoints.registerStart.responseSchema
>;
export type RegisterStartQueryParams = z.infer<
  typeof API_SPEC.endpoints.registerStart.queryParams
>;

export type RegisterFinishRequest = z.infer<
  typeof API_SPEC.endpoints.registerFinish.requestSchema
>;
export type RegisterFinishResponse = z.infer<
  typeof API_SPEC.endpoints.registerFinish.responseSchema
>;

export type LoginStartRequest = z.infer<
  typeof API_SPEC.endpoints.loginStart.requestSchema
>;
export type LoginStartResponse = z.infer<
  typeof API_SPEC.endpoints.loginStart.responseSchema
>;

export type LoginFinishRequest = z.infer<
  typeof API_SPEC.endpoints.loginFinish.requestSchema
>;
export type LoginFinishResponse = z.infer<
  typeof API_SPEC.endpoints.loginFinish.responseSchema
>;

export type LogoutRequest = z.infer<
  typeof API_SPEC.endpoints.logout.requestSchema
>;
export type LogoutResponse = z.infer<
  typeof API_SPEC.endpoints.logout.responseSchema
>;

export type HealthRequest = z.infer<
  typeof API_SPEC.endpoints.health.requestSchema
>;
export type HealthResponse = z.infer<
  typeof API_SPEC.endpoints.health.responseSchema
>;

export type AuthStatusRequest = z.infer<
  typeof API_SPEC.endpoints.authStatus.requestSchema
>;
export type AuthStatusResponse = z.infer<
  typeof API_SPEC.endpoints.authStatus.responseSchema
>;

// WebAuthn specific types
export type WebAuthnCredential = z.infer<typeof WebAuthnCredentialSchema>;
export type WebAuthnAssertion = z.infer<typeof WebAuthnAssertionSchema>;
export type WebAuthnPublicKeyCredentialCreationOptions = z.infer<
  typeof WebAuthnPublicKeyCredentialCreationOptionsSchema
>;
export type WebAuthnPublicKeyCredentialRequestOptions = z.infer<
  typeof WebAuthnPublicKeyCredentialRequestOptionsSchema
>;
