import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { useAdminTransport } from "../admin/context";
import { dispatchOrThrow, type AdminTarget } from "../admin/transport";

export interface DiskFolderSelection {
  device_path: string;
  mount_path: string;
  relative_path: string;
}
interface RemovableVolume {
  device_path: string;
  uuid: string | null;
  partition_uuid: string | null;
  label: string | null;
  filesystem: string;
  mount_points: string[];
}
interface SourceFolder {
  name: string;
  relative_path: string;
}
type HostDispatch = <T>(command: string, args?: unknown) => Promise<T>;

function required<T>(data: T | null | undefined): T {
  if (data == null) throw new Error("library command returned no data");
  return data;
}

export default function LibraryDiskPicker(props: {
  disabled?: boolean;
  onSelectionChange: (selection: DiskFolderSelection | undefined) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const admin = useAdminTransport();
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [volumes, setVolumes] = createSignal<RemovableVolume[]>([]);
  const [selection, setSelection] = createSignal<DiskFolderSelection>();
  const [folders, setFolders] = createSignal<SourceFolder[]>([]);
  let generation = 0;
  let client: HostDispatch;

  function choose(next: DiskFolderSelection | undefined) {
    setSelection(next);
    props.onSelectionChange(next);
  }
  createEffect(() => props.onBusyChange(busy()));
  onCleanup(() => {
    generation++;
  });
  createEffect(() => {
    const target = admin.current();
    const destination: AdminTarget =
      target.kind === "remote" && target.peerAddr
        ? { kind: "remote", peerAddr: target.peerAddr }
        : { kind: "local" };
    client = <T,>(command: string, args: unknown = {}) => {
      if (target.kind === "remote" && !target.peerAddr)
        throw new Error("missing remote peer address");
      return dispatchOrThrow<T>(command, args, destination);
    };
    generation++;
    setBusy(false);
    setVolumes([]);
    choose(undefined);
    setFolders([]);
    setError("");
    void refresh();
  });

  async function refresh() {
    const request = ++generation;
    const host = client;
    setBusy(true);
    setError("");
    choose(undefined);
    try {
      const disks = await host<RemovableVolume[]>("library_list_removable_volumes");
      if (request !== generation) return;
      setVolumes(required(disks));
    } catch (e) {
      if (request === generation) setError(String(e));
    } finally {
      if (request === generation) setBusy(false);
    }
  }

  async function browse(next: DiskFolderSelection) {
    if (admin.current().kind === "local") {
      choose(next);
      setFolders([]);
      setError("");
      return;
    }
    const request = ++generation;
    const host = client;
    setBusy(true);
    setError("");
    try {
      const children = required(await host<SourceFolder[]>("library_browse_volume", next));
      if (request !== generation) return;
      choose(next);
      setFolders(children);
    } catch (e) {
      if (request === generation) setError(String(e));
    } finally {
      if (request === generation) setBusy(false);
    }
  }

  async function browseLocalFolder() {
    const current = selection();
    if (!current || admin.current().kind !== "local") return;
    const request = ++generation;
    setBusy(true);
    setError("");
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: current.mount_path,
        title: "choose a folder on this disk",
      });
      if (request !== generation || selected === null) return;
      if (typeof selected !== "string") throw new Error("choose one folder");
      const windows = /^[a-z]:[\\/]|^\\\\/i.test(current.mount_path);
      const normalize = (path: string) =>
        (windows
          ? path
              .replace(/\\/g, "/")
              .replace(/^\/\/\?\/UNC\//i, "//")
              .replace(/^\/\/\?\//, "")
          : path
        ).replace(/\/+$/, "");
      const mount = normalize(current.mount_path);
      const path = normalize(selected);
      const compare = (path: string) => (windows ? path.toLowerCase() : path);
      if (compare(path) !== compare(mount) && !compare(path).startsWith(`${compare(mount)}/`))
        throw new Error("choose a folder on the selected disk");
      const relative = path.slice(mount.length).replace(/^\//, "");
      if (relative.split("/").some((part) => part === ".." || part === "."))
        throw new Error("choose a folder on the selected disk");
      choose({ ...current, relative_path: relative });
    } catch (e) {
      if (request === generation) setError(String(e));
    } finally {
      if (request === generation) setBusy(false);
    }
  }

  const locked = () => busy() || props.disabled;
  return (
    <div class="form-group">
      <Show when={!selection()}>
        <button class="secondary small" disabled={locked()} onClick={() => void refresh()}>
          refresh disks
        </button>
      </Show>
      <Show when={!selection()}>
        <p class="hint">mounted disks on {admin.current().label}; media stays on disk.</p>
      </Show>
      <Show when={busy()}>
        <p role="status">working...</p>
      </Show>
      <Show when={error()}>
        <p class="scan-progress error" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={!selection()}>
        <For each={volumes()}>
          {(volume) => (
            <div>
              <p>
                {volume.label || volume.device_path} · {volume.filesystem}
              </p>
              <Show when={!volume.mount_points.length}>
                <p class="hint">not mounted - mount through the host OS first</p>
              </Show>
              <Show when={!volume.uuid && !volume.partition_uuid}>
                <p class="hint">no stable disk identity; use a manual path instead</p>
              </Show>
              <For each={volume.mount_points}>
                {(mount) => (
                  <button
                    class="secondary small"
                    disabled={locked() || (!volume.uuid && !volume.partition_uuid)}
                    onClick={() =>
                      void browse({
                        device_path: volume.device_path,
                        mount_path: mount,
                        relative_path: "",
                      })
                    }
                  >
                    {admin.current().kind === "local" ? "select" : "browse"} {mount}
                  </button>
                )}
              </For>
            </div>
          )}
        </For>
        <Show when={!busy() && !error() && !volumes().length}>
          <p class="hint">no removable library disks found</p>
        </Show>
      </Show>
      <Show when={selection()}>
        {(current) => (
          <div>
            <p>
              {current().mount_path} / {current().relative_path || "(whole disk)"}
            </p>
            <div class="button-row">
              <button
                class="secondary small"
                disabled={locked()}
                onClick={() => {
                  choose(undefined);
                  setError("");
                }}
              >
                change disk
              </button>
              <Show when={admin.current().kind === "local"}>
                <button
                  class="secondary small"
                  disabled={locked()}
                  onClick={() => void browseLocalFolder()}
                >
                  browse folder...
                </button>
              </Show>
              <Show when={admin.current().kind === "remote"}>
                <Show when={current().relative_path}>
                  <button
                    class="secondary small"
                    disabled={locked()}
                    onClick={() =>
                      void browse({
                        ...current(),
                        relative_path: current().relative_path.split("/").slice(0, -1).join("/"),
                      })
                    }
                  >
                    parent folder
                  </button>
                </Show>
                <For each={folders()}>
                  {(folder) => (
                    <button
                      class="secondary small"
                      disabled={locked()}
                      onClick={() =>
                        void browse({
                          ...current(),
                          relative_path: folder.relative_path,
                        })
                      }
                    >
                      {folder.name}
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
