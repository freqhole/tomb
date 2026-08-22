// shared seed-value autocomplete inputs, extracted out of
// `RadioAdminView.tsx` so any admin-command-driven filter editor
// (radio station seeds, removable-storage sync filter-sets) can reuse
// the same lookup UI.
//
// both inputs query `radio_seed_suggest` over the given admin transport
// (debounced ~200ms) — for a P2P remote that's the remote's own library,
// for the local charnel-managed node (via `getLocalAdminClient()`) it's
// the local library. uses the native <datalist> for keyboard nav +
// accessibility; for songs we keep a label↔id map so the user picks by
// title but we still submit the uuid the caller actually needs.

import { createSignal, createEffect, onCleanup, For } from "solid-js";
import { type AdminClient, type RadioSeedSuggestion } from "@freqhole/api-client";

export interface SeedSuggestInputProps {
  client: AdminClient;
  kind: "tag" | "taxon" | "artist" | "album" | "playlist";
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function SeedSuggestInput(props: SeedSuggestInputProps) {
  const listId = `seed-suggest-${Math.random().toString(36).slice(2, 9)}`;
  const [items, setItems] = createSignal<RadioSeedSuggestion[]>([]);
  const [text, setText] = createSignal("");
  let timer: number | null = null;

  // when caller resets value (e.g. after submit / type switch), wipe the
  // visible text too — props.value is the FK id, not the display label.
  createEffect(() => {
    if (props.value === "") setText("");
  });

  const fetchSuggestions = (q: string) => {
    if (timer !== null) window.clearTimeout(timer);
    if (q.trim().length === 0) {
      setItems([]);
      return;
    }
    timer = window.setTimeout(async () => {
      try {
        const data = await props.client.dispatchOrThrow("radio_seed_suggest", {
          kind: props.kind,
          query: q.trim(),
          limit: 15,
        });
        setItems((data ?? []) as RadioSeedSuggestion[]);
      } catch {
        // silent: autocomplete is opportunistic.
        setItems([]);
      }
    }, 200);
  };

  // resolve typed text → FK id: only commit when there's an exact label
  // match in the current suggestion list. server enforces FK ids now,
  // free-text would always fail the schema CHECK.
  const resolve = (typed: string) => {
    const match = items().find((it) => it.name === typed);
    props.onChange(match ? match.id : "");
  };

  onCleanup(() => {
    if (timer !== null) window.clearTimeout(timer);
  });

  return (
    <>
      <input
        class="flex-1 min-w-[10rem] text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
        type="text"
        list={listId}
        placeholder={props.placeholder ?? "value"}
        value={text()}
        disabled={props.disabled}
        autocomplete="off"
        onInput={(e) => {
          const v = e.currentTarget.value;
          setText(v);
          fetchSuggestions(v);
          resolve(v);
        }}
        onFocus={(e) => fetchSuggestions(e.currentTarget.value)}
      />
      <datalist id={listId}>
        <For each={items()}>
          {(it) => <option value={it.name}>{it.subtitle ? `${it.subtitle}` : ""}</option>}
        </For>
      </datalist>
    </>
  );
}

export interface SongSuggestInputProps {
  client: AdminClient;
  value: string;
  onChange: (songId: string) => void;
  disabled?: boolean;
}

export function SongSuggestInput(props: SongSuggestInputProps) {
  const listId = `song-suggest-${Math.random().toString(36).slice(2, 9)}`;
  const [items, setItems] = createSignal<RadioSeedSuggestion[]>([]);
  // local input shows the human label; props.value tracks the resolved id.
  const [text, setText] = createSignal("");
  let timer: number | null = null;

  // when caller resets value (e.g. after submit), clear the visible text too.
  createEffect(() => {
    if (props.value === "") setText("");
  });

  const fetchSuggestions = (q: string) => {
    if (timer !== null) window.clearTimeout(timer);
    if (q.trim().length === 0) {
      setItems([]);
      return;
    }
    timer = window.setTimeout(async () => {
      try {
        const data = await props.client.dispatchOrThrow("radio_seed_suggest", {
          kind: "song",
          query: q.trim(),
          limit: 15,
        });
        setItems((data ?? []) as RadioSeedSuggestion[]);
      } catch {
        setItems([]);
      }
    }, 200);
  };

  // resolve typed text → id: prefer exact label match in current items, else
  // pass through (allowing pasted uuids).
  const resolve = (typed: string) => {
    const match = items().find((it) => it.name === typed);
    props.onChange(match ? match.id : typed.trim());
  };

  onCleanup(() => {
    if (timer !== null) window.clearTimeout(timer);
  });

  return (
    <>
      <input
        class="flex-1 text-xs px-2 py-1 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
        type="text"
        list={listId}
        placeholder="song title or uuid"
        value={text()}
        disabled={props.disabled}
        autocomplete="off"
        onInput={(e) => {
          const v = e.currentTarget.value;
          setText(v);
          fetchSuggestions(v);
          resolve(v);
        }}
        onFocus={(e) => fetchSuggestions(e.currentTarget.value)}
      />
      <datalist id={listId}>
        <For each={items()}>{(it) => <option value={it.name}>{it.subtitle ?? ""}</option>}</For>
      </datalist>
    </>
  );
}
