// shared types for domain method factories

import { z } from "zod";

// result types
type SafeParseSuccess<T> = { success: true; data: T };
type SafeParseError = { success: false; error: z.ZodError };
export type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseError;

// the call function signature used by domain methods
export type CallFn = <Resp>(
  domain: string,
  routeName: string,
  respSchema: z.ZodType<Resp> | null,
  reqSchema: z.ZodTypeAny | null,
  method: string,
  path: string,
  params?: any,
) => Promise<SafeParseResult<Resp>>;
