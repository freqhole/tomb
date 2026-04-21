// user autocomplete for the remote admin view.
//
// ported from client/charnel/src/components/UserAutocomplete.tsx, styled
// with tailwind + css vars to match the rest of spume settings.
//
// loads users via the (untyped) `users_list` admin command and lets the
// caller pick an existing user or type a new username. parent gets a
// `UserSelection` describing whether it's an existing user (with id and
// current role) or a new one (with the chosen default role).

import { createSignal, createMemo, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import { adminRawDispatch } from "../../app/api/adminClient";
import type { Remote } from "../../app/services/storage/schemas/remote";

interface UserInfo {
  id: string;
  username: string;
  role: string;
}

export interface UserSelection {
  id?: string;
  username: string;
  role: string;
  isExisting: boolean;
}

interface UserAutocompleteProps {
  remote: Remote;
  /** initial username to prefill (e.g. the knock's proposed username) */
  initialValue?: string;
  /** called whenever the input changes or an option is picked */
  onSelect: (selection: UserSelection | null) => void;
  /** role applied to newly-created users (existing users keep their role) */
  defaultRole?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function UserAutocomplete(props: UserAutocompleteProps) {
  const [inputValue, setInputValue] = createSignal(props.initialValue ?? "");
  const [users, setUsers] = createSignal<UserInfo[]>([]);
  const [isOpen, setIsOpen] = createSignal(false);
  const [selectedUser, setSelectedUser] = createSignal<UserInfo | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  let containerRef: HTMLDivElement | undefined;

  const loadUsers = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await adminRawDispatch<UserInfo[]>(props.remote, "users_list", {
        include_deleted: false,
      });
      setUsers(Array.isArray(result) ? result : []);
    } catch (e) {
      console.error("[user-autocomplete] users_list failed", e);
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // load once on mount. the `remote` prop is expected to be stable for the
  // lifetime of this component; if it changes, remount by keying the parent.
  onMount(() => {
    void loadUsers();
  });

  // when users finish loading, try to match the initial value to an existing
  // user and emit the selection. runs only when `users` changes (which is
  // effectively a single "loaded" transition).
  let matchedInitial = false;
  createEffect(() => {
    const list = users();
    if (matchedInitial) return;
    if (list.length === 0) return;
    matchedInitial = true;
    const initial = props.initialValue;
    if (!initial) return;
    const match = list.find((u) => u.username.toLowerCase() === initial.toLowerCase());
    if (match) {
      setSelectedUser(match);
      props.onSelect({
        id: match.id,
        username: match.username,
        role: match.role,
        isExisting: true,
      });
    }
  });

  const filteredUsers = createMemo(() => {
    const search = inputValue().toLowerCase().trim();
    if (!search) return users();
    return users().filter((u) => u.username.toLowerCase().includes(search));
  });

  const exactMatch = createMemo(() => {
    const search = inputValue().toLowerCase().trim();
    if (!search) return null;
    return users().find((u) => u.username.toLowerCase() === search) ?? null;
  });

  const showCreateNew = createMemo(() => {
    const val = inputValue().trim();
    if (!val) return false;
    return !exactMatch();
  });

  const handleInputChange = (value: string) => {
    setInputValue(value);
    setIsOpen(true);
    const trimmed = value.trim();
    const match = users().find((u) => u.username.toLowerCase() === trimmed.toLowerCase());
    if (match) {
      setSelectedUser(match);
      props.onSelect({
        id: match.id,
        username: match.username,
        role: match.role,
        isExisting: true,
      });
    } else {
      setSelectedUser(null);
      if (trimmed) {
        props.onSelect({
          username: trimmed,
          role: props.defaultRole ?? "viewer",
          isExisting: false,
        });
      } else {
        props.onSelect(null);
      }
    }
  };

  const handleSelectUser = (user: UserInfo) => {
    setInputValue(user.username);
    setSelectedUser(user);
    setIsOpen(false);
    props.onSelect({
      id: user.id,
      username: user.username,
      role: user.role,
      isExisting: true,
    });
  };

  const handleSelectCreateNew = () => {
    const username = inputValue().trim();
    setSelectedUser(null);
    setIsOpen(false);
    props.onSelect({
      username,
      role: props.defaultRole ?? "viewer",
      isExisting: false,
    });
  };

  const handleClickOutside = (e: MouseEvent) => {
    if (containerRef && !containerRef.contains(e.target as Node)) {
      setIsOpen(false);
    }
  };

  createEffect(() => {
    if (isOpen()) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }
  });

  onCleanup(() => {
    document.removeEventListener("mousedown", handleClickOutside);
  });

  return (
    <div class="relative" ref={containerRef}>
      <div class="flex items-center gap-2">
        <input
          type="text"
          value={inputValue()}
          onInput={(e) => handleInputChange(e.currentTarget.value)}
          onFocus={() => setIsOpen(true)}
          placeholder={props.placeholder ?? "search or type username..."}
          disabled={props.disabled}
          autocomplete="off"
          class="flex-1 text-xs px-2 py-1 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-500)] disabled:opacity-50"
        />
        <Show when={selectedUser()}>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-accent-500)]/20 text-[var(--color-accent-400)] whitespace-nowrap">
            {selectedUser()!.role}
          </span>
        </Show>
      </div>

      <Show when={loadError()}>
        <div class="mt-1 text-[10px] text-red-400">users load failed: {loadError()}</div>
      </Show>

      <Show
        when={
          isOpen() &&
          !props.disabled &&
          (filteredUsers().length > 0 || showCreateNew() || loading())
        }
      >
        <div class="absolute left-0 right-0 top-full mt-1 z-10 max-h-56 overflow-y-auto rounded-md border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] shadow-lg">
          <Show when={showCreateNew()}>
            <button
              type="button"
              class="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--color-bg-secondary)] text-[var(--color-accent-400)] border-b border-[var(--color-border-subtle)]"
              onClick={handleSelectCreateNew}
            >
              <span class="text-[var(--color-text-muted)]">create new:</span> {inputValue().trim()}
            </button>
          </Show>
          <Show when={loading()}>
            <div class="px-2 py-1.5 text-xs text-[var(--color-text-muted)]">loading...</div>
          </Show>
          <For each={filteredUsers()}>
            {(user) => (
              <button
                type="button"
                class="w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--color-bg-secondary)] flex items-center justify-between gap-2"
                classList={{
                  "bg-[var(--color-bg-secondary)]": selectedUser()?.id === user.id,
                }}
                onClick={() => handleSelectUser(user)}
              >
                <span class="text-[var(--color-text-primary)]">{user.username}</span>
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]">
                  {user.role}
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
