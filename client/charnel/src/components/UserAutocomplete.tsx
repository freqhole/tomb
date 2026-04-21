// user autocomplete component for federation view
// allows selecting existing users or creating new ones

import {
  createSignal,
  createMemo,
  For,
  Show,
  onCleanup,
  createEffect,
} from "solid-js";
import { useAdminTransport } from "../admin/context";

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
  /** initial username value */
  initialValue?: string;
  /** callback when selection changes */
  onSelect: (selection: UserSelection | null) => void;
  /** placeholder text */
  placeholder?: string;
  /** whether the input is disabled */
  disabled?: boolean;
  /** default role for new users */
  defaultRole?: string;
}

export function UserAutocomplete(props: UserAutocompleteProps) {
  const admin = useAdminTransport();
  const [inputValue, setInputValue] = createSignal(props.initialValue || "");
  const [users, setUsers] = createSignal<UserInfo[]>([]);
  const [isOpen, setIsOpen] = createSignal(false);
  const [selectedUser, setSelectedUser] = createSignal<UserInfo | null>(null);
  const [loading, setLoading] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;

  // load users on mount
  createEffect(() => {
    loadUsers();
  });

  // sync initialValue changes
  createEffect(() => {
    const initial = props.initialValue;
    if (initial !== undefined) {
      setInputValue(initial);
      // check if this matches an existing user
      const match = users().find(
        (u) => u.username.toLowerCase() === initial.toLowerCase(),
      );
      if (match) {
        setSelectedUser(match);
        // notify parent of existing user match
        props.onSelect({
          id: match.id,
          username: match.username,
          role: match.role,
          isExisting: true,
        });
      } else {
        setSelectedUser(null);
      }
    }
  });

  async function loadUsers() {
    setLoading(true);
    try {
      const result = await admin.dispatchOrThrow<UserInfo[]>("users_list", {
        include_deleted: false,
      });
      setUsers(result);
    } catch (e) {
      console.error("failed to load users:", e);
    } finally {
      setLoading(false);
    }
  }

  // filter users based on input
  const filteredUsers = createMemo(() => {
    const search = inputValue().toLowerCase().trim();
    if (!search) return users();
    return users().filter((u) => u.username.toLowerCase().includes(search));
  });

  // check if input matches an existing user exactly
  const exactMatch = createMemo(() => {
    const search = inputValue().toLowerCase().trim();
    if (!search) return null;
    return users().find((u) => u.username.toLowerCase() === search) || null;
  });

  // check if we should show "create new" option
  const showCreateNew = createMemo(() => {
    const val = inputValue().trim();
    if (!val) return false;
    // show create new if no exact match
    return !exactMatch();
  });

  function handleInputChange(value: string) {
    setInputValue(value);
    setIsOpen(true);

    // check for exact match
    const match = users().find(
      (u) => u.username.toLowerCase() === value.toLowerCase().trim(),
    );

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
      if (value.trim()) {
        props.onSelect({
          username: value.trim(),
          role: props.defaultRole || "viewer",
          isExisting: false,
        });
      } else {
        props.onSelect(null);
      }
    }
  }

  function handleSelectUser(user: UserInfo) {
    setInputValue(user.username);
    setSelectedUser(user);
    setIsOpen(false);
    props.onSelect({
      id: user.id,
      username: user.username,
      role: user.role,
      isExisting: true,
    });
  }

  function handleSelectCreateNew() {
    const username = inputValue().trim();
    setSelectedUser(null);
    setIsOpen(false);
    props.onSelect({
      username,
      role: props.defaultRole || "viewer",
      isExisting: false,
    });
  }

  // close dropdown when clicking outside
  function handleClickOutside(e: MouseEvent) {
    if (containerRef && !containerRef.contains(e.target as Node)) {
      setIsOpen(false);
    }
  }

  // setup/teardown click outside listener
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
    <div class="user-autocomplete" ref={containerRef}>
      <div class="user-autocomplete-input-wrapper">
        <input
          type="text"
          value={inputValue()}
          onInput={(e) => handleInputChange(e.currentTarget.value)}
          onFocus={() => setIsOpen(true)}
          placeholder={props.placeholder || "search or type username..."}
          disabled={props.disabled}
          autocomplete="off"
        />
        <Show when={selectedUser()}>
          <span class="user-role-badge">{selectedUser()!.role}</span>
        </Show>
      </div>

      <Show
        when={
          isOpen() &&
          !props.disabled &&
          (filteredUsers().length > 0 || showCreateNew())
        }
      >
        <div class="user-autocomplete-dropdown">
          <Show when={showCreateNew()}>
            <div
              class="user-autocomplete-option create-new"
              onClick={handleSelectCreateNew}
            >
              <span class="create-new-label">create new:</span>{" "}
              {inputValue().trim()}
            </div>
          </Show>

          <Show when={loading()}>
            <div class="user-autocomplete-loading">loading...</div>
          </Show>

          <For each={filteredUsers()}>
            {(user) => (
              <div
                class="user-autocomplete-option"
                classList={{ selected: selectedUser()?.id === user.id }}
                onClick={() => handleSelectUser(user)}
              >
                <span class="username">{user.username}</span>
                <span class="role-badge">{user.role}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
