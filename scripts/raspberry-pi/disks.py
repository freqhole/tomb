#!/usr/bin/python3 -I
"""root helper: persist read-only removable filesystems and remount them now."""

import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile


ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LC_ALL": "C"}
RULES = Path("/etc/udev/rules.d")
SYSTEM_MOUNTS = {"/", "/boot", "/boot/firmware", "/usr", "/var", "/home", "/etc", "/opt"}


def run(*args):
    result = subprocess.run(args, env=ENV, check=True, capture_output=True, text=True, timeout=45)
    return result.stdout.strip()


def eligible_volume(devices, path, uuid):
    if not re.fullmatch(r"/dev/[a-zA-Z0-9_-]+", path):
        raise ValueError("invalid block device path")
    if not re.fullmatch(r"[a-zA-Z0-9-]{1,128}", uuid):
        raise ValueError("disk has no supported filesystem UUID")
    matches = []
    uuids = []

    def visit(node, ancestors):
        if node.get("uuid") == uuid:
            uuids.append(node)
        if node["path"] == path:
            matches.append((node, ancestors))
        for child in node.get("children", []):
            visit(child, [*ancestors, node])

    for disk in devices:
        visit(disk, [])
    if len(matches) != 1 or len(uuids) != 1:
        raise ValueError("disk disconnected or filesystem UUID is not unique")
    volume, ancestors = matches[0]
    if volume.get("uuid") != uuid or volume.get("type") not in ("disk", "part"):
        raise ValueError("selected disk changed; reopen library disks")
    chain = [*ancestors, volume]
    if not any(n.get("type") == "disk" and (n.get("rm") in (True, 1, "1") or n.get("tran") == "usb") for n in chain):
        raise ValueError("only removable or USB disks are supported")
    if any(n.get("type") not in ("disk", "part") for n in chain):
        raise ValueError("mapped storage devices are not supported")

    def system_disk(node):
        mounts = [p for p in node.get("mountpoints", []) if p]
        return (
            node.get("fstype") == "swap"
            or any(p in SYSTEM_MOUNTS or not p.startswith(("/media/", "/run/media/", "/mnt/")) for p in mounts)
            or any(system_disk(child) for child in node.get("children", []))
        )

    if system_disk(chain[0]):
        raise ValueError("refusing a system disk or a disk mounted outside /media, /run/media, /mnt")
    return volume


def inventory():
    return json.loads(run(
        "/usr/bin/lsblk", "--json", "--paths", "--tree", "--output",
        "PATH,TYPE,TRAN,RM,RO,UUID,FSTYPE,MOUNTPOINTS,MAJ:MIN",
    ))["blockdevices"]


def device_identity(path):
    device = os.stat(path)
    if not stat.S_ISBLK(device.st_mode):
        raise ValueError("selected path is not a block device")
    return device.st_rdev


def make_read_only(path, uuid):
    volume = eligible_volume(inventory(), path, uuid)
    identity = device_identity(path)
    for mount in volume.get("mountpoints", []):
        if not mount:
            continue
        current = eligible_volume(inventory(), path, uuid)
        if device_identity(path) != identity or mount not in current.get("mountpoints", []):
            raise ValueError("disk or mount changed; reopen library disks")
        major_minor = run("/usr/bin/findmnt", "--noheadings", "--raw", "--mountpoint", mount, "--output", "MAJ:MIN")
        if major_minor != volume["maj:min"]:
            raise ValueError("mount no longer belongs to the selected disk")
        run("/usr/bin/mount", "-o", "remount,ro", "--", mount)
    eligible_volume(inventory(), path, uuid)
    if device_identity(path) != identity:
        raise ValueError("disk changed before setting read-only")
    run("/usr/sbin/blockdev", "--setro", path)
    if run("/usr/sbin/blockdev", "--getro", path) != "1":
        raise ValueError("kernel did not make the disk read-only")
    for mount in volume.get("mountpoints", []):
        if mount:
            options = run("/usr/bin/findmnt", "--noheadings", "--raw", "--mountpoint", mount, "--output", "OPTIONS")
            if "ro" not in options.split(","):
                raise ValueError("a mounted filesystem is still writable")

    # the UUID rule runs before desktop automounting after replugging or reboot.
    rule = (
        '# managed by freqhole-pi; remove this file to restore writable automounts\n'
        f'ACTION=="add", SUBSYSTEM=="block", ENV{{ID_FS_UUID}}=="{uuid}", '
        'RUN+="/usr/sbin/blockdev --setro /dev/%k"\n'
    )
    RULES.mkdir(mode=0o755, parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=RULES, prefix=".freqhole-", delete=False) as output:
            temporary = Path(output.name)
            output.write(rule)
            output.flush()
            os.fsync(output.fileno())
            os.fchmod(output.fileno(), 0o644)
        temporary.replace(RULES / f"99-freqhole-readonly-{uuid}.rules")
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    run("/usr/bin/udevadm", "control", "--reload-rules")
    return {"read_only": True, "persistent": True, "uuid": uuid}


def main():
    if os.geteuid() != 0:
        raise ValueError("this helper requires root")
    if len(sys.argv) != 4 or sys.argv[1] != "read-only":
        raise ValueError("usage: freqhole-pi-disks read-only /dev/DEVICE UUID")
    fd = os.open("/run/freqhole-pi-disks.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "r+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(make_read_only(sys.argv[2], sys.argv[3])))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        detail = error.stderr.strip() if isinstance(error, subprocess.CalledProcessError) else str(error)
        print(f"read-only disk setup failed: {detail}; check current mount state before retrying", file=sys.stderr)
        sys.exit(1)
