// admin client - typed wrapper around the freqhole-admin/1 ALPN.
//
// pairs with the generated `codegen/admin_commands.ts` map to give every
// command a request/response zod schema validated at the client edge.
//
// transport-agnostic: takes an `AdminTransport` that knows how to ship a
// raw `(command, args)` to a particular destination (local in-process,
// remote over P2P from a wasm runtime, remote via tauri bridge).
//
// see docs/spume-remote-admin-plan.md.

import { z } from "zod";
import { adminCommands, type AdminCommandName } from "./codegen/admin_commands.js";

/** rfc 9457-ish error detail, matches grimoire `ErrorDetail`. */
export interface AdminErrorDetail {
  error_type: string;
  title: string;
  detail: string;
}

/** standard grimoire response envelope. */
export interface AdminResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: AdminErrorDetail[];
}

/**
 * transport responsible for shipping a raw admin envelope.
 *
 * implementations:
 * - browser P2P: midden `proxy_admin(peer_addr, command, args)`
 * - tauri local: `invoke("admin_dispatch")`
 * - tauri remote: `invoke("admin_dispatch_remote")`
 *
 * the transport must return a shape conforming to `AdminResponse<unknown>`;
 * `AdminClient.dispatch` will then zod-validate the `data` payload against
 * the command-specific response schema.
 */
export interface AdminTransport {
  send(command: string, args: unknown): Promise<AdminResponse<unknown>>;
}

/** thrown when the response envelope's `data` fails its zod schema. */
export class AdminResponseValidationError extends Error {
  constructor(
    public readonly command: string,
    public readonly issues: z.ZodIssue[],
  ) {
    super(`admin response for ${command} failed validation`);
    this.name = "AdminResponseValidationError";
  }
}

/** thrown when the request `args` fail their zod schema before send. */
export class AdminRequestValidationError extends Error {
  constructor(
    public readonly command: string,
    public readonly issues: z.ZodIssue[],
  ) {
    super(`admin request for ${command} failed validation`);
    this.name = "AdminRequestValidationError";
  }
}

/** thrown when the server returns `success: false`. */
export class AdminCommandError extends Error {
  constructor(
    public readonly command: string,
    public readonly response: AdminResponse<unknown>,
  ) {
    const detail =
      response.errors?.[0]?.detail ?? response.message ?? "admin command failed";
    const errType = response.errors?.[0]?.error_type;
    super(errType ? `${errType}: ${detail}` : detail);
    this.name = "AdminCommandError";
  }

  get errorType(): string | undefined {
    return this.response.errors?.[0]?.error_type;
  }
}

type CommandReq<K extends AdminCommandName> = z.infer<
  (typeof adminCommands)[K]["req"]
>;
type CommandResp<K extends AdminCommandName> = z.infer<
  (typeof adminCommands)[K]["resp"]
>;

/**
 * typed admin command client.
 *
 * usage:
 * ```ts
 * const admin = new AdminClient(transport);
 * const knocks = await admin.dispatchOrThrow("knocks_list", undefined);
 * ```
 */
export class AdminClient {
  constructor(private readonly transport: AdminTransport) {}

  /** dispatch and return the full envelope (success or failure). */
  async dispatch<K extends AdminCommandName>(
    command: K,
    args: CommandReq<K>,
  ): Promise<AdminResponse<CommandResp<K>>> {
    const def = adminCommands[command];

    // validate request before sending
    const reqParse = def.req.safeParse(args);
    if (!reqParse.success) {
      throw new AdminRequestValidationError(command, reqParse.error.issues);
    }

    const raw = await this.transport.send(command, reqParse.data ?? null);

    // failure envelopes pass through unvalidated; data is typically absent
    if (!raw.success) {
      return raw as AdminResponse<CommandResp<K>>;
    }

    // validate data against response schema
    if (raw.data === undefined || raw.data === null) {
      // some commands legitimately return no data (EmptyResponse); accept it
      return raw as AdminResponse<CommandResp<K>>;
    }
    const respParse = def.resp.safeParse(raw.data);
    if (!respParse.success) {
      throw new AdminResponseValidationError(command, respParse.error.issues);
    }

    return {
      success: true,
      message: raw.message,
      data: respParse.data as CommandResp<K>,
      errors: raw.errors,
    };
  }

  /** dispatch and unwrap data, throwing `AdminCommandError` on failure. */
  async dispatchOrThrow<K extends AdminCommandName>(
    command: K,
    args: CommandReq<K>,
  ): Promise<CommandResp<K>> {
    const response = await this.dispatch(command, args);
    if (!response.success) {
      throw new AdminCommandError(command, response);
    }
    return response.data as CommandResp<K>;
  }
}
