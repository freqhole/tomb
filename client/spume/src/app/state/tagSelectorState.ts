// global tag-selector modal state — domain-neutral (album, video, ...);
// pass whichever TagAdapter matches the entities being tagged.
import { createSignal } from "solid-js";
import type { Remote } from "../services/storage/schemas/remote";
import type { TagAdapter } from "../../components/modals/tagAdapters/types";

export interface TagSelectorOptions {
  entityIds: string[];
  entityTitle?: string;
  entityKindLabel?: string;
  adapter: TagAdapter;
  /** when set, the modal queries/mutates tags on this remote rather
   *  than the globally-active data source. */
  remote?: Remote;
  onSave?: () => void;
}

const [tagSelectorState, setTagSelectorState] = createSignal<TagSelectorOptions | null>(null);

export function showTagSelector(options: TagSelectorOptions) {
  setTagSelectorState(options);
}

export function hideTagSelector() {
  setTagSelectorState(null);
}

export function useTagSelectorState() {
  return tagSelectorState;
}
