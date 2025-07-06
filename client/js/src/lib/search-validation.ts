import { z } from "zod";

// Zod error handling configuration
export interface ZodErrorConfig {
  logErrors: boolean;
  logValidationWarnings: boolean;
  logLevel: "error" | "warn" | "info";
  throwOnCriticalErrors: boolean;
}

export const DEFAULT_ZOD_CONFIG: ZodErrorConfig = {
  logErrors: true,
  logValidationWarnings: true,
  logLevel: "warn",
  throwOnCriticalErrors: true,
};

// Utility for partial collection parsing
export function createPartialArraySchema<T>(
  itemSchema: z.ZodSchema<T>,
  config: ZodErrorConfig = DEFAULT_ZOD_CONFIG
) {
  return z.array(z.unknown()).transform((items) => {
    const validItems: T[] = [];
    const errors: Array<{ index: number; item: unknown; error: z.ZodError }> =
      [];

    for (let i = 0; i < items.length; i++) {
      const result = itemSchema.safeParse(items[i]);
      if (result.success) {
        validItems.push(result.data);
      } else {
        errors.push({ index: i, item: items[i], error: result.error });
      }
    }

    // Log validation errors if configured
    if (errors.length > 0 && config.logValidationWarnings) {
      const logFn = console[config.logLevel] || console.warn;
      logFn(
        `[Search] Filtered out ${errors.length}/${items.length} invalid items in collection`,
        {
          errors: errors.map((e) => ({
            index: e.index,
            actualItem: e.item, // Show the actual invalid item
            issues: e.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
              code: issue.code,
              ...("received" in issue && { received: issue.received }),
              ...("expected" in issue && { expected: issue.expected }),
            })),
          })),
          sampleInvalidItem: errors[0]?.item,
          allInvalidItems: errors.map((e) => e.item), // Show all invalid items for debugging
        }
      );
    }

    return validItems;
  });
}

// Enhanced request schema with error handling
export function createRequestSchema<T>(
  schema: z.ZodSchema<T>,
  config: ZodErrorConfig = DEFAULT_ZOD_CONFIG
) {
  return {
    parse: (data: unknown): T => {
      try {
        return schema.parse(data);
      } catch (error) {
        if (error instanceof z.ZodError && config.logErrors) {
          const logFn = console[config.logLevel] || console.error;
          logFn("[Search] Request validation failed:", {
            error: error.issues,
            data: data,
          });
        }
        if (config.throwOnCriticalErrors) {
          throw error;
        }
        return data as T; // Fallback to unvalidated data
      }
    },
    safeParse: (data: unknown) => schema.safeParse(data),
  };
}

// Validation utilities class
export class SearchValidation {
  constructor(private config: ZodErrorConfig = DEFAULT_ZOD_CONFIG) {}

  // Validate search request parameters
  validateSearchOptions<T>(
    schema: z.ZodSchema<T>,
    data: unknown,
    context: string
  ): T {
    const result = schema.safeParse(data);

    if (!result.success) {
      if (this.config.logErrors) {
        const logFn = console[this.config.logLevel] || console.error;
        logFn(`[Search] ${context} validation failed:`, {
          errors: result.error.issues,
          data,
        });
      }

      if (this.config.throwOnCriticalErrors) {
        throw new Error(
          `${context} validation failed: ${result.error.message}`
        );
      }

      return data as T; // Fallback to unvalidated data
    }

    return result.data;
  }

  // Validate collections with partial success
  validateCollection<T>(
    itemSchema: z.ZodSchema<T>,
    items: unknown[],
    context: string
  ): T[] {
    const validItems: T[] = [];
    const errors: Array<{ index: number; error: z.ZodError }> = [];

    for (let i = 0; i < items.length; i++) {
      const result = itemSchema.safeParse(items[i]);
      if (result.success) {
        validItems.push(result.data);
      } else {
        errors.push({ index: i, error: result.error });
      }
    }

    if (errors.length > 0 && this.config.logValidationWarnings) {
      const logFn = console[this.config.logLevel] || console.warn;
      logFn(
        `[Search] ${context}: ${errors.length}/${items.length} items failed validation`,
        {
          successRate: `${validItems.length}/${items.length}`,
          errors: errors.slice(0, 3).map((e) => ({
            index: e.index,
            issues: e.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          })),
          ...(errors.length > 3 && { additionalErrors: errors.length - 3 }),
        }
      );
    }

    return validItems;
  }

  // Validate response with graceful degradation
  validateResponse<T>(
    schema: z.ZodSchema<T>,
    data: unknown,
    context: string
  ): T {
    const result = schema.safeParse(data);

    if (!result.success) {
      if (this.config.logErrors) {
        const logFn = console[this.config.logLevel] || console.error;
        logFn(`[Search] ${context} response validation failed:`, {
          errors: result.error.issues,
          rawResponse: data,
        });
      }

      if (this.config.throwOnCriticalErrors) {
        throw new Error(
          `${context} response validation failed: ${result.error.message}`
        );
      }

      // Return raw response as fallback
      return data as T;
    }

    return result.data;
  }

  // Update configuration
  updateConfig(config: Partial<ZodErrorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // Get current configuration
  getConfig(): ZodErrorConfig {
    return { ...this.config };
  }
}

// Export configured validation instance
export const searchValidation = new SearchValidation();

// Utility function to create validation-aware response schemas
export function createValidatedResponseSchema<T>(
  baseSchema: z.ZodSchema<T>,
  config: ZodErrorConfig = DEFAULT_ZOD_CONFIG
) {
  return z.unknown().transform((data) => {
    const validation = new SearchValidation(config);
    return validation.validateResponse(baseSchema, data, "API Response");
  });
}
