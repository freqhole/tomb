// "new taxon kind" creation form - a collapsed "+ new kind" link that
// expands into a label/slug/create row. extracted from
// VideoTaxonsEditor.tsx so BulkVideoTaxonsEditor.tsx (season edit modal's
// shared-taxon editing, bulk edit modal) can offer the same capability -
// without it, a domain that starts with zero taxon kinds (video: every
// legacy kind was scoped to domain='music' by migration 067, see its
// comment) has no way to create the first one from either modal.
import { createSignal, onMount, Show } from "solid-js";
import type { TaxonomyClient } from "../../music/data";
import { Icon, IconNames } from "../icons/registry";
import { toast } from "../feedback/Toast";

export interface NewTaxonKindFormHandle {
  /** collapses the form and clears any typed-but-not-created text -
   *  kinds already created aren't affected (creation is immediate, not
   *  buffered), this only tidies up the inline form's own UI state. */
  reset: () => void;
}

export interface NewTaxonKindFormProps {
  /** client to call `createTaxonKind` against - pass whatever the
   *  caller's own kinds/links resources already resolved (local shim or
   *  the active/explicit remote client), so this form works uniformly
   *  without its own global lookup. */
  client: TaxonomyClient | null;
  /** domain tag for the new kind (e.g. "video"). */
  domain: string;
  /** invoked after a successful create so the caller can refetch kinds. */
  onCreated: () => void;
  disabled?: boolean;
  /** called once on mount with an imperative handle the parent can use
   *  to collapse/clear the form (e.g. on its own cancel/reset). */
  ref?: (handle: NewTaxonKindFormHandle) => void;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

export function NewTaxonKindForm(props: NewTaxonKindFormProps) {
  const [showForm, setShowForm] = createSignal(false);
  const [label, setLabel] = createSignal("");
  const [slug, setSlug] = createSignal("");
  const [slugDirty, setSlugDirty] = createSignal(false);
  const [creating, setCreating] = createSignal(false);

  const resetForm = () => {
    setShowForm(false);
    setLabel("");
    setSlug("");
    setSlugDirty(false);
  };

  onMount(() => {
    props.ref?.({ reset: resetForm });
  });

  const handleCreate = async () => {
    const trimmedLabel = label().trim();
    const trimmedSlug = (slugDirty() ? slug() : slugify(trimmedLabel)).trim();
    if (!trimmedLabel || !trimmedSlug) {
      toast.error("label and slug are required");
      return;
    }
    if (!props.client) {
      toast.error("not connected to a remote");
      return;
    }
    setCreating(true);
    try {
      const resp = await props.client.music.createTaxonKind({
        slug: trimmedSlug,
        label: trimmedLabel,
        description: null,
        color: null,
        value_type: null,
        unit: null,
        display_order: null,
        domain: props.domain,
      });
      if (!resp.success) {
        toast.error(`failed to create kind "${trimmedSlug}"`);
        return;
      }
      resetForm();
      props.onCreated();
    } catch (err) {
      console.error("failed to create taxon kind:", err);
      toast.error(`failed to create kind "${trimmedSlug}"`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Show when={!props.disabled}>
      <Show
        when={showForm()}
        fallback={
          <button
            type="button"
            onClick={() => setShowForm(true)}
            class="inline-flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <Icon name={IconNames.add} size={12} />
            new kind
          </button>
        }
      >
        <div class="space-y-1.5 p-2 rounded border border-dashed border-[var(--color-border-default)] bg-[var(--color-bg-secondary,var(--color-bg-primary))]/40">
          <div class="flex items-center justify-between">
            <span class="text-xs uppercase tracking-wide text-[var(--color-text-tertiary)]">
              new taxon kind
            </span>
            <button
              type="button"
              onClick={resetForm}
              class="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
              aria-label="cancel"
            >
              <Icon name={IconNames.close} size={12} />
            </button>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <input
              type="text"
              value={label()}
              onInput={(e) => {
                const v = e.currentTarget.value;
                setLabel(v);
                if (!slugDirty()) setSlug(slugify(v));
              }}
              placeholder="label (e.g. tempo, region)"
              disabled={creating()}
              class="flex-1 min-w-[140px] px-2 py-1 text-xs bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
            />
            <input
              type="text"
              value={slug()}
              onInput={(e) => {
                setSlug(e.currentTarget.value);
                setSlugDirty(true);
              }}
              placeholder="slug"
              disabled={creating()}
              class="w-28 px-2 py-1 text-xs bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] border border-[var(--color-border-default)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--color-accent-500)]"
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating()}
              class="px-2 py-1 text-xs text-[var(--color-accent-500)] hover:text-[var(--color-accent-400)] disabled:opacity-50"
            >
              {creating() ? "creating..." : "create"}
            </button>
          </div>
        </div>
      </Show>
    </Show>
  );
}

export default NewTaxonKindForm;
