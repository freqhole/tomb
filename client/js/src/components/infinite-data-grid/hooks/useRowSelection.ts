import { createSignal } from "solid-js";

export function useRowSelection<T>(props: {
  data: T[];
  getItemId: (item: T) => string;
  onSelectionChange?: (
    selectedIds: Set<string>,
    lastSelectedId?: string
  ) => void;
}) {
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = createSignal<number>(-1);
  const [focusedIndex, setFocusedIndex] = createSignal<number>(0);

  const handleRowClick = (item: T, index: number, event: MouseEvent) => {
    const itemId = props.getItemId(item);
    const current = new Set(selectedIds());

    if (event.shiftKey && lastSelectedIndex() >= 0) {
      // range selection
      const start = Math.min(lastSelectedIndex(), index);
      const end = Math.max(lastSelectedIndex(), index);
      for (let i = start; i <= end; i++) {
        if (i < props.data.length && props.data[i] != null) {
          current.add(props.getItemId(props.data[i]!));
        }
      }
    } else if (event.ctrlKey || event.metaKey) {
      // toggle selection
      if (current.has(itemId)) {
        current.delete(itemId);
      } else {
        current.add(itemId);
      }
    } else {
      // single selection
      current.clear();
      current.add(itemId);
    }

    setSelectedIds(current);
    setLastSelectedIndex(index);
    setFocusedIndex(index);
    props.onSelectionChange?.(current, itemId);
  };

  const selectAll = () => {
    const allIds = new Set<string>(
      props.data.map((item) => props.getItemId(item))
    );
    setSelectedIds(() => allIds);
    const lastId =
      props.data.length > 0
        ? props.getItemId(props.data[props.data.length - 1]!)
        : undefined;
    props.onSelectionChange?.(allIds, lastId);
  };

  const clearSelection = () => {
    setSelectedIds(() => new Set<string>());
    setLastSelectedIndex(-1);
    props.onSelectionChange?.(new Set<string>(), undefined);
  };

  const selectRange = (startIndex: number, endIndex: number) => {
    const current = new Set(selectedIds());
    const start = Math.min(startIndex, endIndex);
    const end = Math.max(startIndex, endIndex);

    for (let i = start; i <= end; i++) {
      if (i < props.data.length && props.data[i] != null) {
        const itemId = props.getItemId(props.data[i]!);
        current.add(itemId);
      }
    }

    setSelectedIds(current);
    const lastId =
      endIndex < props.data.length
        ? props.getItemId(props.data[endIndex]!)
        : undefined;
    props.onSelectionChange?.(current, lastId);
  };

  return {
    selectedIds,
    focusedIndex,
    setFocusedIndex,
    handleRowClick,
    selectAll,
    clearSelection,
    selectRange,
    isSelected: (itemId: string) => selectedIds().has(itemId),
  };
}
