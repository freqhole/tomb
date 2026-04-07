import type { DocHandle } from "@automerge/automerge-repo";
import { z } from "zod";
import type { WidgetDoc } from "./widget-types";

/**
 * create a zod-validated facade over an automerge DocHandle.
 * this is the internal function used by the canvas to create
 * per-widget document wrappers. widgets never call this directly.
 *
 * the facade:
 * - validates all reads through the zod schema (security boundary)
 * - falls back to schema defaults if validation fails (graceful degradation)
 * - exposes change() for mutations and on("change") for subscriptions
 * - never exposes the underlying DocHandle to widget code
 */
export function createWidgetDoc<S extends z.ZodType>(
  schema: S,
  handle: DocHandle<any>
): WidgetDoc<S> {
  type State = z.infer<S>;

  let cachedState: State | null = null;

  function parseDoc(): State {
    const raw = handle.doc();
    try {
      return schema.parse(raw ?? {});
    } catch (err) {
      // graceful degradation: if peer data is corrupt, use defaults.
      // log the error so schema mismatches are visible during development.
      console.warn(
        "[widget-doc] schema parse failed — falling back to defaults. error:",
        err instanceof z.ZodError ? err.issues : err,
        "raw keys:",
        raw ? Object.keys(raw) : "null"
      );
      return schema.parse({});
    }
  }

  return {
    get current(): State {
      if (cachedState === null) {
        cachedState = parseDoc();
      }
      return cachedState;
    },

    change(fn: (draft: State) => void): void {
      handle.change(fn);
      cachedState = null; // invalidate cache
    },

    on(_event: "change", handler: (state: State) => void): () => void {
      const listener = () => {
        cachedState = null; // invalidate cache
        handler(parseDoc());
      };
      handle.on("change", listener);
      return () => {
        handle.off("change", listener);
      };
    },
  };
}
