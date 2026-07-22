// a reactive solid adapter over an automerge DocHandle with
// caller-supplied parsing/validation. this is a generic pattern for
// building solid signals around any automerge document type - the caller
// provides the parse function (their own zod validator, or anything else
// that turns unknown into a safe default), and this module wires the
// automerge event lifecycle into solid reactivity.
//
// usage inside a solid component or reactive root:
//
//   const handle = await repo.find<MyDoc>(url);
//   const { doc, loading } = createDocStore(handle, parseMyDoc);
//   // doc() is always a caller-parsed MyDoc (defaults on corrupt/missing)
//   // loading() is true until the handle is ready or terminal

import { createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type {
  DocHandle,
  DocHandleChangePayload,
  DocHandleDeletePayload,
} from "@automerge/automerge-repo";

export interface DocStore<T> {
  doc: Accessor<T>;
  loading: Accessor<boolean>;
}

/**
 * creates a reactive solid store backed by an automerge DocHandle. the doc
 * accessor is always a caller-validated snapshot - corrupt or
 * future-versioned peer data degrades to whatever the parse function
 * returns for unknown/invalid input. loading becomes false once
 * whenReady() resolves or rejects.
 *
 * @param handle - the automerge DocHandle to track
 * @param parse - a function that converts unknown to T, providing defaults
 *   for missing/corrupt data (typically a zod schema's parse with a default
 *   fallback, but any unknown->T function works)
 */
export function createDocStore<T>(
  handle: DocHandle<unknown>,
  parse: (raw: unknown) => T
): DocStore<T> {
  // try to read whatever the handle has now (may be undefined before ready)
  let initialRaw: unknown;
  try {
    initialRaw = handle.doc();
  } catch {
    initialRaw = undefined;
  }

  const [loading, setLoading] = createSignal(initialRaw === undefined);
  const [doc, setDoc] = createSignal<T>(parse(initialRaw), { equals: false });

  // resolve handle readiness in the background
  handle
    .whenReady()
    .then(() => {
      let current: unknown;
      try {
        current = handle.doc();
      } catch {
        current = undefined;
      }
      setLoading(false);
      setDoc(() => parse(current));
    })
    .catch(() => {
      setLoading(false);
    });

  const changeHandler = (payload: DocHandleChangePayload<unknown>) => {
    setDoc(() => parse(payload.doc));
  };

  const deleteHandler = (_payload: DocHandleDeletePayload<unknown>) => {
    setLoading(false);
  };

  handle.on("change", changeHandler);
  handle.on("delete", deleteHandler);

  onCleanup(() => {
    handle.off("change", changeHandler);
    handle.off("delete", deleteHandler);
  });

  return { doc, loading };
}

/**
 * convenience wrapper: apply a mutation to an automerge doc handle. the
 * mutatorFn receives a mutable automerge draft and should modify it in
 * place (safe to call shared mutation helpers from consuming apps).
 *
 * @param handle - the automerge DocHandle to mutate
 * @param mutatorFn - a function that modifies the doc's draft in place
 */
export function changeDoc<T>(
  handle: DocHandle<T>,
  mutatorFn: (draft: T) => void
): void {
  handle.change(mutatorFn);
}
