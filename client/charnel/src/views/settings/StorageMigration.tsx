import { createSignal, For, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { resolvePath } from "../../util/resolvePath";
import OptionSelect, { type SelectOption } from "../../components/OptionSelect";

type Operation = "move_data" | "select_data" | "move_fetch";
interface Preview {
  operation: Operation;
  source: string;
  destination: string;
  files: number;
  bytes: number;
  identical: number;
  collisions: string[];
  blockers: string[];
  destination_has_media: boolean;
  blocked_reason: string | null;
}

type Choice = Operation | "select_fetch";

export default function StorageMigration(props: {
  kind: "data" | "fetch";
  disabled?: boolean;
  /** fetch only: points future fetches at a folder without moving anything. */
  onSelectFetchFolder?: () => void;
}) {
  const [preview, setPreview] = createSignal<Preview>();
  const [busy, setBusy] = createSignal(false);
  const [merge, setMerge] = createSignal(false);
  const [confirmation, setConfirmation] = createSignal("");
  const [error, setError] = createSignal("");
  const [queued, setQueued] = createSignal(false);

  async function choose(operation: Operation) {
    setBusy(true);
    setError("");
    setPreview(undefined);
    setMerge(false);
    setConfirmation("");
    try {
      const selected = await open({ multiple: false, directory: true });
      if (typeof selected !== "string") return;
      const destination = await resolvePath(selected);
      setPreview(await invoke<Preview>("preview_storage_change", { operation, destination }));
    } catch (e) {
      setError(`could not inspect storage: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    const report = preview();
    if (!report) return;
    setBusy(true);
    setError("");
    try {
      await invoke("schedule_storage_change", {
        operation: report.operation,
        destination: report.destination,
        merge: merge(),
        confirmation: confirmation(),
      });
      setQueued(true);
      await invoke("close_for_storage_change");
    } catch (e) {
      setError(
        queued()
          ? `storage change is queued; close the app manually. ${e}`
          : `storage change was not queued: ${e}`,
      );
    } finally {
      setBusy(false);
    }
  }

  const options = (): SelectOption<Choice>[] =>
    props.kind === "data"
      ? [
          { value: "move_data", label: "move existing data directory" },
          { value: "select_data", label: "select a new folder" },
        ]
      : [
          { value: "move_fetch", label: "move existing files" },
          ...(props.onSelectFetchFolder
            ? [{ value: "select_fetch" as const, label: "select new folder for future fetches" }]
            : []),
        ];

  return (
    <div style={{ "margin-top": "0.75rem" }}>
      <OptionSelect
        aria-label={props.kind === "data" ? "change data directory" : "change fetched music folder"}
        options={options()}
        placeholder={busy() ? "checking..." : "change folder..."}
        disabled={busy() || queued() || props.disabled}
        onChange={(choice) =>
          choice === "select_fetch" ? props.onSelectFetchFolder?.() : choose(choice)
        }
      />
      <Show when={preview()}>
        {(report) => (
          <div role="region" aria-label="confirm storage change" style={{ "margin-top": "1rem" }}>
            <p style={{ "overflow-wrap": "anywhere" }}>
              {report().source} → {report().destination}
            </p>
            <Show when={report().operation !== "select_data"}>
              <p>
                {report().files} files, {(report().bytes / 1024 / 1024).toFixed(1)} MiB;{" "}
                {report().identical} identical files can be reused after verification.
              </p>
            </Show>
            <Show
              when={report().blockers.length > 0 || report().blocked_reason}
              fallback={
                <>
                  <p>
                    <strong>
                      WARNING: this closes Charnel. close any other freqhole apps using these
                      folders. keep both disks connected and do not edit either folder during
                      migration.
                    </strong>
                  </p>
                  <p>
                    {report().operation === "select_data"
                      ? "no files will move or be deleted. the next launch opens first-time setup for a fresh library/node."
                      : "the next launch copies and verifies files, updates database paths and config, then deletes the old copies. never overwrite destination files. the original config stays in place. do not disconnect storage while this runs."}
                  </p>
                  <Show when={report().destination_has_media}>
                    <p>
                      existing destination media stays untouched. it is not automatically imported;
                      scan this folder afterward using library → add directory.
                    </p>
                  </Show>
                  <Show when={report().collisions.length > 0}>
                    <p>
                      {report().collisions.length} different media files have matching names. choose
                      another folder, or explicitly merge to keep both under different names.
                    </p>
                    <label style={{ display: "flex", gap: "0.5rem", "align-items": "center" }}>
                      <input
                        type="checkbox"
                        checked={merge()}
                        onChange={(e) => setMerge(e.currentTarget.checked)}
                      />
                      merge: keep both files and update library paths
                    </label>
                  </Show>
                  <label style={{ display: "block", "margin-top": "0.75rem" }}>
                    type “move my storage” to confirm
                    <input
                      aria-label="storage confirmation"
                      value={confirmation()}
                      onInput={(e) => setConfirmation(e.currentTarget.value)}
                      disabled={busy() || queued()}
                    />
                  </label>
                  <button
                    class="button"
                    onClick={commit}
                    disabled={
                      busy() ||
                      queued() ||
                      confirmation() !== "move my storage" ||
                      (report().collisions.length > 0 && !merge())
                    }
                  >
                    confirm and close app
                  </button>
                </>
              }
            >
              <p role="alert">
                {report().blocked_reason ||
                  "this folder contains freqhole/non-media files or incompatible paths. nothing will be overwritten. choose another folder."}
              </p>
              <Show
                when={report().blockers.length <= 5}
                fallback={<p>{report().blockers.length} files block this destination.</p>}
              >
                <ul>
                  <For each={report().blockers}>
                    {(path) => <li style={{ "overflow-wrap": "anywhere" }}>{path}</li>}
                  </For>
                </ul>
              </Show>
            </Show>
            <button
              class="button"
              disabled={busy() || queued()}
              onClick={() => setPreview(undefined)}
            >
              cancel
            </button>
          </div>
        )}
      </Show>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
    </div>
  );
}
