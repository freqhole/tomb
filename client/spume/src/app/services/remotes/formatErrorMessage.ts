// format error messages from api responses.
// handles zod validation errors (json arrays) and plain strings.
export function formatErrorMessage(error: unknown): string {
  if (!error) return "unknown error";

  const errorStr = String(error);

  // try to parse as JSON array (zod validation errors)
  try {
    const parsed = JSON.parse(errorStr);
    if (Array.isArray(parsed)) {
      // extract messages from zod-style error objects
      const messages = parsed
        .map((e) => {
          if (typeof e === "object" && e !== null) {
            // prefer 'message' field
            if (e.message) return String(e.message);
            // fallback to stringifying
            return JSON.stringify(e);
          }
          return String(e);
        })
        .filter((msg) => msg && msg.length > 0);

      if (messages.length > 0) {
        return messages.join("; ");
      }
    } else if (typeof parsed === "object" && parsed !== null) {
      // single error object
      if (parsed.message) return String(parsed.message);
      if (parsed.detail) return String(parsed.detail);
      if (parsed.error) return String(parsed.error);
    }
  } catch {
    // not JSON, use as-is
  }

  return errorStr;
}
