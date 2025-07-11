// Import ApiError type only to avoid circular dependencies

export interface MusicErrorContext {
  endpoint: string;
  operation: string;
  params?: Record<string, unknown>;
  data?: unknown;
  timestamp: string;
}

export class MusicApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public responseText: string,
    public context: MusicErrorContext,
    public retryable: boolean = false,
    public endpoint?: string
  ) {
    super(message);
    this.name = "MusicApiError";
  }

  static fromApiError(error: any, context: MusicErrorContext): MusicApiError {
    return new MusicApiError(
      error.message,
      error.status,
      error.responseText,
      context,
      this.isRetryable(error.status),
      context.endpoint
    );
  }

  static isRetryable(status: number): boolean {
    // Retry on temporary server errors, not client errors
    return status >= 500 || status === 408 || status === 429;
  }

  toLogEntry(): Record<string, unknown> {
    return {
      type: "music_api_error",
      message: this.message,
      status: this.status,
      endpoint: this.context.endpoint,
      operation: this.context.operation,
      timestamp: this.context.timestamp,
      retryable: this.retryable,
      params: this.context.params,
      data: this.context.data,
    };
  }
}

export interface MusicApiLogger {
  logError(error: MusicApiError): void;
  logSuccess(context: MusicErrorContext, result?: unknown): void;
  logWarning(message: string, context: Partial<MusicErrorContext>): void;
  logInfo(message: string, context: Partial<MusicErrorContext>): void;
}

export class DefaultMusicApiLogger implements MusicApiLogger {
  private logLevel: "error" | "warn" | "info" | "debug" = "info";

  constructor(logLevel?: "error" | "warn" | "info" | "debug") {
    this.logLevel = logLevel || "info";
  }

  logError(error: MusicApiError): void {
    console.error("🎵 Music API Error:", error.toLogEntry());

    // Log additional context for debugging
    if (error.context.params) {
      console.error("📝 Request params:", error.context.params);
    }

    if (error.context.data) {
      console.error("📦 Request data:", error.context.data);
    }
  }

  logSuccess(context: MusicErrorContext, result?: unknown): void {
    if (this.logLevel === "debug") {
      console.log("✅ Music API Success:", {
        operation: context.operation,
        endpoint: context.endpoint,
        timestamp: context.timestamp,
        resultType: result ? typeof result : "void",
        resultLength: Array.isArray(result) ? result.length : undefined,
      });
    }
  }

  logWarning(message: string, context: Partial<MusicErrorContext>): void {
    if (["warn", "info", "debug"].includes(this.logLevel)) {
      console.warn("⚠️ Music API Warning:", {
        message,
        ...context,
        timestamp: new Date().toISOString(),
      });
    }
  }

  logInfo(message: string, context: Partial<MusicErrorContext>): void {
    if (["info", "debug"].includes(this.logLevel)) {
      console.info("ℹ️ Music API Info:", {
        message,
        ...context,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
}

export class MusicApiErrorHandler {
  private logger: MusicApiLogger;
  private retryOptions: RetryOptions;

  constructor(
    logger: MusicApiLogger = new DefaultMusicApiLogger(),
    retryOptions: RetryOptions = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      backoffFactor: 2,
    }
  ) {
    this.logger = logger;
    this.retryOptions = retryOptions;
  }

  async handleWithRetry<T>(
    operation: () => Promise<T>,
    context: MusicErrorContext
  ): Promise<T> {
    let lastError: MusicApiError | null = null;
    let attempt = 0;

    while (attempt <= this.retryOptions.maxRetries) {
      try {
        const result = await operation();

        // Log success on retry
        if (attempt > 0) {
          this.logger.logInfo(
            `Operation succeeded after ${attempt} retries`,
            context
          );
        }

        this.logger.logSuccess(context, result);
        return result;
      } catch (error) {
        attempt++;

        let musicError: MusicApiError;
        if (error && typeof error === "object" && "status" in error) {
          musicError = MusicApiError.fromApiError(error, context);
        } else if (error instanceof MusicApiError) {
          musicError = error;
        } else {
          musicError = new MusicApiError(
            error instanceof Error ? error.message : "Unknown error",
            0,
            String(error),
            context,
            false
          );
        }

        lastError = musicError;
        this.logger.logError(musicError);

        // Don't retry if not retryable or max retries reached
        if (!musicError.retryable || attempt > this.retryOptions.maxRetries) {
          break;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          this.retryOptions.baseDelay *
            Math.pow(this.retryOptions.backoffFactor, attempt - 1),
          this.retryOptions.maxDelay
        );

        this.logger.logWarning(
          `Retrying operation in ${delay}ms (attempt ${attempt}/${this.retryOptions.maxRetries})`,
          context
        );

        await this.delay(delay);
      }
    }

    throw lastError || new Error("Operation failed with no error details");
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  createContext(
    endpoint: string,
    operation: string,
    params?: Record<string, unknown>,
    data?: unknown
  ): MusicErrorContext {
    return {
      endpoint,
      operation,
      params,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  // Graceful degradation helpers
  withGracefulDegradation<T>(
    operation: () => Promise<T>,
    fallback: T,
    context: MusicErrorContext
  ): Promise<T> {
    return this.handleWithRetry(operation, context).catch((_error) => {
      this.logger.logWarning(`Operation failed, using fallback value`, {
        ...context,
      });
      return fallback;
    });
  }

  withGracefulCollection<T>(
    operation: () => Promise<T[]>,
    context: MusicErrorContext
  ): Promise<T[]> {
    return this.withGracefulDegradation(operation, [], context);
  }
}

// Default singleton instance
export const musicErrorHandler = new MusicApiErrorHandler();

// Utility functions for common patterns
export const musicApiUtils = {
  /**
   * Wrap an API call with error handling and retry logic
   */
  async withErrorHandling<T>(
    operation: () => Promise<T>,
    endpoint: string,
    operationName: string,
    params?: Record<string, unknown>,
    data?: unknown
  ): Promise<T> {
    const context = musicErrorHandler.createContext(
      endpoint,
      operationName,
      params,
      data
    );

    return musicErrorHandler.handleWithRetry(operation, context);
  },

  /**
   * Wrap a collection API call with graceful degradation
   */
  async withGracefulCollection<T>(
    operation: () => Promise<T[]>,
    endpoint: string,
    operationName: string,
    params?: Record<string, unknown>
  ): Promise<T[]> {
    const context = musicErrorHandler.createContext(
      endpoint,
      operationName,
      params
    );

    return musicErrorHandler.withGracefulCollection(operation, context);
  },

  /**
   * Wrap an API call with a fallback value
   */
  async withFallback<T>(
    operation: () => Promise<T>,
    fallback: T,
    endpoint: string,
    operationName: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    const context = musicErrorHandler.createContext(
      endpoint,
      operationName,
      params
    );

    return musicErrorHandler.withGracefulDegradation(
      operation,
      fallback,
      context
    );
  },

  /**
   * Create a standardized error message for user display
   */
  createUserFriendlyError(error: MusicApiError): string {
    if (error.status === 0) {
      return "Network connection failed. Please check your internet connection.";
    }

    if (error.status === 401) {
      return "Authentication required. Please log in again.";
    }

    if (error.status === 403) {
      return "You don't have permission to perform this action.";
    }

    if (error.status === 404) {
      return "The requested item was not found.";
    }

    if (error.status === 429) {
      return "Too many requests. Please wait a moment and try again.";
    }

    if (error.status >= 500) {
      return "Server error. Please try again later.";
    }

    return "An unexpected error occurred. Please try again.";
  },

  /**
   * Check if an error should be shown to the user
   */
  shouldShowToUser(error: MusicApiError): boolean {
    // Don't show user errors for retryable server errors (they'll be retried)
    if (error.retryable && error.status >= 500) {
      return false;
    }

    // Show user errors for authentication, authorization, and client errors
    return error.status >= 400 && error.status < 500;
  },
};
