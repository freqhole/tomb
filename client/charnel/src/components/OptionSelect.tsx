import { For, Show } from "solid-js";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

export const ROLE_OPTIONS: SelectOption[] = [
  { value: "admin", label: "admin" },
  { value: "member", label: "member" },
  { value: "viewer", label: "viewer" },
];

/** compact dropdown shared by role pickers and action menus. with a
 * `placeholder` it acts as an action menu: the placeholder stays shown and
 * picking an option fires `onChange` once without keeping the choice selected. */
export default function OptionSelect<T extends string>(props: {
  options: SelectOption<T>[];
  value?: T;
  placeholder?: string;
  onChange: (value: T) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <select
      class="option-select"
      aria-label={props["aria-label"]}
      disabled={props.disabled}
      value={props.value ?? ""}
      onChange={(e) => {
        const value = e.currentTarget.value as T;
        if (props.placeholder !== undefined) e.currentTarget.value = "";
        props.onChange(value);
      }}
    >
      <Show when={props.placeholder !== undefined}>
        <option value="" disabled hidden selected={props.value === undefined}>
          {props.placeholder}
        </option>
      </Show>
      <For each={props.options}>
        {(option) => (
          // `selected` too: dynamic options can mount after the select's value is set.
          <option value={option.value} selected={option.value === props.value}>
            {option.label}
          </option>
        )}
      </For>
    </select>
  );
}
