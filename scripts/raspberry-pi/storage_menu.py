"""event-driven, hardware-independent disk/folder picker for the OLED menu."""

from collections import deque
from concurrent.futures import ThreadPoolExecutor
import json
import socket
import sys
from threading import Event
import time


def request(path, command, args=None, *, cancelled=None):
    if cancelled is not None and cancelled.is_set():
        raise OSError("storage request cancelled")
    timeout = 25 if command == "watch" else 30
    deadline = time.monotonic() + timeout
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(2)
        connection.connect(path)
        payload = {"command": command, "args": args or {}}
        connection.sendall(("library_storage " + json.dumps(payload) + "\n").encode())
        reply = bytearray()
        while b"\n" not in reply:
            if cancelled is not None and cancelled.is_set():
                raise OSError("storage request cancelled")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("storage request timed out")
            connection.settimeout(min(0.5, remaining) if cancelled is not None else remaining)
            try:
                chunk = connection.recv(4096)
            except socket.timeout:
                if cancelled is None:
                    raise
                continue
            if not chunk:
                raise ValueError("player closed storage request without a reply")
            reply.extend(chunk)
            if len(reply) > 1024 * 1024:
                raise ValueError("storage reply too large")
    response = json.loads(reply.split(b"\n", 1)[0])
    if not isinstance(response, dict) or response.get("success") is not True:
        errors = response.get("errors", []) if isinstance(response, dict) else []
        detail = errors[0].get("detail") if isinstance(errors, list) and errors and isinstance(errors[0], dict) else None
        message = response.get("message") if isinstance(response, dict) else None
        raise ValueError(detail or message or "invalid storage reply")
    if response.get("data") is None:
        raise ValueError("storage reply has no data")
    return response["data"]


def inventory(path, *, cancelled=None):
    volumes = request(path, "library_list_removable_volumes", cancelled=cancelled)
    sources = request(path, "library_list_sources", cancelled=cancelled)
    if not isinstance(volumes, list) or not isinstance(sources, list):
        raise ValueError("invalid storage inventory")
    for volume in volumes:
        if (
            not isinstance(volume, dict)
            or not isinstance(volume.get("device_path"), str)
            or not isinstance(volume.get("mount_points"), list)
            or not all(isinstance(p, str) for p in volume["mount_points"])
        ):
            raise ValueError("invalid storage volume")
    for source in sources:
        if not isinstance(source, dict) or not isinstance(source.get("id"), str):
            raise ValueError("invalid library source")
    return volumes, sources


class StorageMenu:
    def __init__(self, socket_path):
        self.socket_path = socket_path
        self.worker = ThreadPoolExecutor(max_workers=2)
        self.cancelled = Event()
        self.watch_future = None
        self.future = None
        self.operation = None
        self.revision = None
        self.next_watch = 0
        self.refresh = False
        self.volumes = []
        self.sources = []
        self.mounted = set()
        self.notices = deque()
        self.current = None
        self.selection = None
        self.folders = []
        self.mode = "disks"
        self.selected = 0
        self.notice_until = None
        self.active = False
        self.dirty = False
        self.error = None
        self.watch_path = None
        self.target_path = socket_path()
        self.operation_path = None
        self.watch_failed = False

    def submit(self, operation, function, *args):
        if self.future is not None:
            return
        self.operation = operation
        self.operation_path = self.socket_path()
        self.future = self.worker.submit(function, *args, cancelled=self.cancelled)
        self.dirty = True

    def open(self):
        self.active = True
        self.mode = "disks"
        self.selected = 0
        self.refresh = True
        self.error = None
        self.dirty = True

    @staticmethod
    def key(volume, mount):
        return (volume["device_path"], volume.get("uuid"), volume.get("partition_uuid"), mount)

    def known(self, volume):
        return any(
            (volume.get("uuid") is not None or volume.get("partition_uuid") is not None)
            and source.get("volume_uuid") == volume.get("uuid")
            and source.get("partition_uuid") == volume.get("partition_uuid")
            for source in self.sources
        )

    def entries(self):
        if self.mode == "notice":
            return ["add entire disk", "choose folder", "not now"]
        if self.mode == "folders":
            return ["use this folder", "parent folder" if self.selection["relative_path"] else "back to disks",
                    *[folder["name"] for folder in self.folders]]
        if self.mode == "disks":
            return ["back", "refresh disks", *[
                (volume.get("label") or volume["device_path"]) +
                ("" if volume["mount_points"] else " (unmounted)")
                for volume in self.volumes
            ]]
        return ["back"]

    def lines(self):
        if self.future is not None and self.active:
            return ["storage: working...", self.operation, "press: back"]
        if self.mode == "known":
            return ["USB DISK MOUNTED!", self.current.get("label") or self.current["device_path"],
                    "known library disk", "press: back"]
        if self.mode == "done":
            return ["source registered", "player auto-scans", "music + video", "press: back"]
        if self.error:
            return ["storage unavailable", self.error[:21], self.error[21:42], "press: back"]
        title = "library disks"
        if self.mode == "notice":
            title = "USB DISK MOUNTED!"
        elif self.mode == "folders":
            title = self.selection["relative_path"].rsplit("/", 1)[-1] or "whole disk"
        entries = self.entries()
        start = max(0, self.selected - 1)
        header = [title]
        if self.mode == "notice":
            header.append(self.current.get("label") or self.current["device_path"])
        return header + [
            ("> " if index == self.selected else "  ") + label
            for index, label in enumerate(entries) if start <= index < start + 4 - len(header)
        ]

    def turn(self, delta):
        if self.future is None and not self.error:
            self.selected = max(0, min(len(self.entries()) - 1, self.selected + delta))
            self.dirty = True

    def choose_volume(self, volume, mount):
        if not volume.get("uuid") and not volume.get("partition_uuid"):
            self.fail(ValueError("disk has no stable UUID; use a manual scan from remote admin"))
            return
        self.current = volume
        self.selection = {
            "device_path": volume["device_path"], "mount_path": mount,
            "relative_path": "", "domain": "both",
        }
        self.browse("")

    def browse(self, relative):
        selection = dict(self.selection, relative_path=relative)
        self.selection = selection
        self.submit("folders", request, self.socket_path(), "library_browse_volume", selection)

    def press(self):
        if self.future is not None or self.error or self.mode in ("known", "done"):
            self.active = False
        elif self.mode == "disks":
            if self.selected == 0:
                self.active = False
            elif self.selected == 1:
                self.refresh = True
            else:
                volume = self.volumes[self.selected - 2]
                if not volume["mount_points"]:
                    self.fail(ValueError("disk is not mounted; mount through the host OS first"))
                else:
                    self.choose_volume(volume, volume["mount_points"][0])
        elif self.mode == "notice":
            if self.selected == 2:
                self.active = False
            elif self.selected == 1:
                self.browse("")
            else:
                self.submit("register", request, self.socket_path(), "library_register_source", self.selection)
        elif self.mode == "folders":
            if self.selected == 0:
                self.submit("register", request, self.socket_path(), "library_register_source", self.selection)
            elif self.selected == 1:
                relative = self.selection["relative_path"]
                if relative:
                    self.browse(relative.rpartition("/")[0])
                else:
                    self.mode = "disks"
                    self.selected = 0
            else:
                self.browse(self.folders[self.selected - 2]["relative_path"])
        self.dirty = True

    def fail(self, error):
        print(f"storage menu failed: {error}", file=sys.stderr, flush=True)
        self.error = str(error)
        self.dirty = True

    def tick(self, now, can_notify):
        path = self.socket_path()
        if self.target_path != path:
            if self.target_path is not None and self.active:
                self.fail(ValueError("player changed; check the previous player before retrying a registration"))
            self.target_path = path
            self.revision = None
            self.mounted.clear()
            self.notices.clear()
            self.volumes = []
            self.sources = []
            self.selection = None
            self.mode = "disks"
            self.selected = 0
            self.refresh = False
            self.next_watch = now
        if self.watch_future is not None and self.watch_future.done():
            try:
                data = self.watch_future.result()
                if not isinstance(data, dict) or not isinstance(data.get("revision"), str):
                    raise ValueError("invalid storage notification")
                if self.watch_path == path and (self.watch_failed or data["revision"] != self.revision):
                    self.revision = data["revision"]
                    self.refresh = True
                    self.watch_failed = False
                self.next_watch = now
            except (OSError, ValueError) as error:
                self.fail(error)
                self.watch_failed = True
                self.next_watch = now + 30
            self.watch_future = None
        if self.watch_future is None and now >= self.next_watch:
            self.watch_path = path
            self.watch_future = self.worker.submit(
                request, path, "watch", {"revision": self.revision}, cancelled=self.cancelled,
            )

        if self.future is not None and self.future.done():
            operation = self.operation
            try:
                data = self.future.result()
                if self.operation_path != path:
                    print("discarding storage reply from the previous player", file=sys.stderr, flush=True)
                elif operation == "inventory":
                    self.error = None
                    self.volumes, self.sources = data
                    mounted = {self.key(v, p) for v in self.volumes for p in v["mount_points"]}
                    for volume in self.volumes:
                        for mount in volume["mount_points"]:
                            key = self.key(volume, mount)
                            if key not in self.mounted:
                                self.notices.append((key, volume, mount))
                    self.mounted = mounted
                    self.selected = min(self.selected, len(self.entries()) - 1)
                    if self.selection is not None and self.active and not any(
                        v["device_path"] == self.selection["device_path"]
                        and self.selection["mount_path"] in v["mount_points"]
                        for v in self.volumes
                    ):
                        self.fail(ValueError("selected disk disconnected; reconnect it and reopen library disks"))
                elif operation == "folders":
                    if not isinstance(data, list) or not all(
                        isinstance(f, dict) and isinstance(f.get("name"), str)
                        and isinstance(f.get("relative_path"), str) for f in data
                    ):
                        raise ValueError("invalid folder list")
                    self.folders = data
                    self.error = None
                    self.mode = "folders"
                    self.selected = 0
                elif operation == "register":
                    if not isinstance(data, dict) or not isinstance(data.get("id"), str):
                        raise ValueError("invalid registration reply")
                    self.sources = [s for s in self.sources if s["id"] != data["id"]] + [data]
                    self.error = None
                    self.mode = "done"
                    self.refresh = True
            except (OSError, ValueError) as error:
                self.fail(error)
            self.future = None
            self.dirty = True
        if self.refresh and self.future is None:
            self.refresh = False
            self.submit("inventory", inventory, path)
        wake = False
        if can_notify and self.future is None and not self.active:
            while self.notices:
                key, volume, mount = self.notices.popleft()
                if key not in self.mounted:
                    continue
                self.current = volume
                self.selection = {
                    "device_path": volume["device_path"], "mount_path": mount,
                    "relative_path": "", "domain": "both",
                }
                self.mode = "known" if self.known(volume) else "notice"
                self.notice_until = now + 8 if self.mode == "known" else None
                self.selected = 0
                self.error = None
                self.active = True
                self.dirty = True
                wake = True
                break
        if self.active and self.mode == "known" and now >= self.notice_until:
            self.active = False
        return wake

    def close(self):
        self.cancelled.set()
        for future in (self.future, self.watch_future):
            if future is not None:
                future.cancel()
        self.worker.shutdown(wait=False, cancel_futures=True)
