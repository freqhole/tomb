/* @jsxImportSource solid-js */

export interface SearchField {
  value: string;
  label: string;
  description?: string;
}

export interface SearchFieldSelectorProps {
  /** Current selected field */
  value?: string;
  /** Callback when field changes */
  onChange?: (field: string) => void;
  /** Available search fields */
  fields: SearchField[];
  /** Additional CSS classes */
  class?: string;
  /** Whether the selector is disabled */
  disabled?: boolean;
}

export function SearchFieldSelector(props: SearchFieldSelectorProps) {
  return (
    <select
      value={props.value || "all"}
      onChange={(e) => props.onChange?.(e.target.value)}
      disabled={props.disabled}
      class={`bg-gray-900 text-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-magenta-500 border-0 border-r border-gray-700 ${props.class || ""}`}
    >
      {props.fields.map((field) => (
        <option value={field.value} title={field.description}>
          {field.label}
        </option>
      ))}
    </select>
  );
}

export default SearchFieldSelector;
