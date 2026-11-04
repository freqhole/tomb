import copy
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import disks


VOLUME = {
    "path": "/dev/sda1", "type": "part", "uuid": "abcd-1234", "fstype": "ext4",
    "mountpoints": ["/media/pi/music"], "maj:min": "8:1",
}
DISK = {"path": "/dev/sda", "type": "disk", "rm": False, "tran": "usb", "children": [VOLUME]}


class ReadOnlyTests(unittest.TestCase):
    def test_usb_fixed_disk_is_supported(self):
        self.assertEqual(disks.eligible_volume([DISK], VOLUME["path"], VOLUME["uuid"]), VOLUME)

    def test_removable_sd_card_is_supported(self):
        disk = dict(DISK, tran=None, rm=True)
        disks.eligible_volume([disk], VOLUME["path"], VOLUME["uuid"])

    def test_system_partitions_on_same_disk_are_rejected(self):
        for mount in ["/", "/boot/firmware", "/home", "/var/lib", "/srv/library"]:
            with self.subTest(mount=mount):
                disk = copy.deepcopy(DISK)
                disk["children"].append(dict(VOLUME, path="/dev/sda2", uuid="other", mountpoints=[mount]))
                with self.assertRaisesRegex(ValueError, "system disk"):
                    disks.eligible_volume([disk], VOLUME["path"], VOLUME["uuid"])

    def test_swap_on_same_disk_is_rejected(self):
        disk = copy.deepcopy(DISK)
        disk["children"].append(dict(VOLUME, path="/dev/sda2", uuid="swap", fstype="swap", mountpoints=[]))
        with self.assertRaisesRegex(ValueError, "system disk"):
            disks.eligible_volume([disk], VOLUME["path"], VOLUME["uuid"])

    def test_internal_disks_duplicate_uuids_and_changed_disks_are_rejected(self):
        cases = [
            [dict(DISK, tran="sata")], [dict(DISK, tran="sata", rm="0")], [],
            [DISK, dict(DISK, path="/dev/sdb", children=[dict(VOLUME, path="/dev/sdb1")])],
            [dict(DISK, children=[dict(VOLUME, uuid="changed")])],
        ]
        for devices in cases:
            with self.subTest(devices=devices), self.assertRaises(ValueError):
                disks.eligible_volume(devices, VOLUME["path"], VOLUME["uuid"])

    def test_untrusted_arguments_cannot_become_rules_or_mount_options(self):
        for path, uuid in [("/etc/fstab", "abcd-1234"), ("/dev/sda1", 'evil"'), ("/dev/../etc/fstab", "id")]:
            with self.assertRaises(ValueError):
                disks.eligible_volume([DISK], path, uuid)

    def test_remount_is_verified_before_persisting_uuid_rule(self):
        commands = []

        def run(*args):
            commands.append(args)
            if args[0].endswith("findmnt"):
                return "8:1" if args[-1] == "MAJ:MIN" else "ro,nosuid,nodev"
            if "--getro" in args:
                return "1"
            return ""

        with tempfile.TemporaryDirectory() as directory:
            with patch.object(disks, "RULES", Path(directory)), patch.object(disks, "inventory", return_value=[DISK]), \
                    patch.object(disks, "device_identity", return_value=2049), \
                    patch.object(disks, "run", side_effect=run):
                result = disks.make_read_only(VOLUME["path"], VOLUME["uuid"])
            self.assertTrue(result["persistent"])
            rule = (Path(directory) / "99-freqhole-readonly-abcd-1234.rules").read_text()
            self.assertIn('ENV{ID_FS_UUID}=="abcd-1234"', rule)
            self.assertIn('RUN+="/usr/sbin/blockdev --setro /dev/%k"', rule)
            self.assertIn(("/usr/bin/mount", "-o", "remount,ro", "--", "/media/pi/music"), commands)
            self.assertEqual(commands[-1], ("/usr/bin/udevadm", "control", "--reload-rules"))

    def test_failed_remount_does_not_persist_or_set_block_readonly(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(disks, "RULES", Path(directory)), patch.object(disks, "inventory", return_value=[DISK]), \
                    patch.object(disks, "device_identity", return_value=2049), \
                    patch.object(disks, "run", side_effect=["8:1", subprocess.CalledProcessError(1, "mount")]):
                with self.assertRaises(subprocess.CalledProcessError):
                    disks.make_read_only(VOLUME["path"], VOLUME["uuid"])
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_changed_mount_kernel_rejection_and_writable_mount_are_not_success(self):
        replies = [
            ["8:2"],
            ["8:1", "", "", "0"],
            ["8:1", "", "", "1", "rw,nosuid,nodev"],
        ]
        for responses in replies:
            with self.subTest(responses=responses), tempfile.TemporaryDirectory() as directory:
                with patch.object(disks, "RULES", Path(directory)), patch.object(disks, "inventory", return_value=[DISK]), \
                        patch.object(disks, "device_identity", return_value=2049), \
                        patch.object(disks, "run", side_effect=responses):
                    with self.assertRaises(ValueError):
                        disks.make_read_only(VOLUME["path"], VOLUME["uuid"])
                self.assertEqual(list(Path(directory).iterdir()), [])
