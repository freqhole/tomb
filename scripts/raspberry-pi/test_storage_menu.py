from concurrent.futures import Future
import json
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from unittest.mock import MagicMock, patch

import menu
import storage_menu as storage


VOLUME = {
    "device_path": "/dev/sda1", "uuid": "disk-1", "partition_uuid": None,
    "mount_points": ["/media/music"], "label": "music", "read_only": True,
}
SOURCE = {"id": "source-1", "volume_uuid": "disk-1", "relative_path": "albums"}


class Worker:
    def __init__(self):
        self.calls = []

    def submit(self, function, *args, **kwargs):
        future = Future()
        self.calls.append((function, args, future))
        return future

    def shutdown(self, **kwargs):
        self.closed = kwargs


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.worker = Worker()
        self.path = "/player.sock"
        with patch.object(storage, "ThreadPoolExecutor", return_value=self.worker):
            self.picker = storage.StorageMenu(lambda: self.path)
        self.addCleanup(self.picker.close)

    def mounted(self, sources=(), can_notify=True):
        self.picker.tick(0, False)
        self.picker.watch_future.set_result({"revision": "process:1"})
        self.picker.tick(1, False)
        self.picker.future.set_result(([dict(VOLUME)], list(sources)))
        return self.picker.tick(2, can_notify)

    def test_unknown_mount_is_sticky_named_and_scans_both_domains(self):
        self.assertTrue(self.mounted())
        self.assertEqual(self.picker.mode, "notice")
        self.assertEqual(self.picker.lines()[:2], ["USB DISK MOUNTED!", "music"])
        self.picker.tick(3600, True)
        self.assertTrue(self.picker.active)
        self.picker.press()
        _, args, _ = self.worker.calls[-1]
        self.assertEqual(args, (self.path, "library_register_source", {
            "device_path": "/dev/sda1", "mount_path": "/media/music",
            "relative_path": "", "domain": "both",
        }))
        self.picker.future.set_result(SOURCE)
        self.picker.tick(3601, False)
        self.assertEqual(self.picker.mode, "done")
        self.assertEqual(self.picker.sources, [SOURCE])

    def test_known_disk_notice_expires_without_registering(self):
        self.mounted([SOURCE])
        self.assertEqual(self.picker.mode, "known")
        self.picker.tick(9, False)
        self.assertTrue(self.picker.active)
        self.picker.tick(10, False)
        self.assertFalse(self.picker.active)
        self.assertFalse(any("library_register_source" in args for _, args, _ in self.worker.calls))

    def test_prompt_defers_until_menu_is_free_and_not_now_is_remembered(self):
        self.assertFalse(self.mounted(can_notify=False))
        self.assertFalse(self.picker.active)
        self.assertTrue(self.picker.tick(3, True))
        self.picker.turn(3)
        self.picker.press()
        self.assertFalse(self.picker.active)
        self.assertFalse(self.picker.tick(4, True))
        self.picker.watch_future.set_result({"revision": "process:2"})
        self.picker.tick(5, True)
        self.picker.future.set_result(([dict(VOLUME)], []))
        self.assertFalse(self.picker.tick(6, True))

    def test_watch_heartbeat_does_not_repeat_inventory(self):
        self.mounted()
        self.picker.watch_future.set_result({"revision": "process:1"})
        self.picker.tick(22, False)
        self.assertIsNone(self.picker.future)
        calls = [call for call in self.worker.calls if call[0] is storage.inventory]
        self.assertEqual(len(calls), 1)

    def test_folder_navigation_parent_and_registration(self):
        self.mounted()
        self.picker.turn(1)
        self.picker.press()
        self.assertEqual(self.worker.calls[-1][1][-1]["relative_path"], "")
        self.picker.future.set_result([{"name": "albums", "relative_path": "albums"}])
        self.picker.tick(3, False)
        self.picker.turn(2)
        self.picker.press()
        self.assertEqual(self.worker.calls[-1][1][-1]["relative_path"], "albums")
        self.picker.future.set_result([{"name": "more", "relative_path": "albums/more"}])
        self.picker.tick(4, False)
        self.picker.turn(1)
        self.picker.press()
        self.assertEqual(self.worker.calls[-1][1][-1]["relative_path"], "")
        self.picker.future.set_result([{"name": "albums", "relative_path": "albums"}])
        self.picker.tick(5, False)
        self.picker.turn(2)
        self.picker.press()
        self.picker.future.set_result([])
        self.picker.tick(6, False)
        self.picker.press()
        self.assertEqual(self.worker.calls[-1][1][-1]["relative_path"], "albums")

    def test_failed_registration_remains_visible_and_is_not_automatically_retried(self):
        self.mounted()
        self.picker.press()
        self.picker.future.set_exception(OSError("disk removed"))
        self.picker.tick(3, False)
        self.assertIn("disk removed", self.picker.error)
        calls = len(self.worker.calls)
        self.picker.tick(4, False)
        self.assertEqual(len(self.worker.calls), calls)
        self.assertEqual(self.picker.lines()[0], "storage unavailable")
        self.picker.press()
        self.assertFalse(self.picker.active)

    def test_disconnect_invalidates_selection_and_reconnect_notifies_again(self):
        self.mounted()
        self.picker.watch_future.set_result({"revision": "process:2"})
        self.picker.tick(3, False)
        self.picker.future.set_result(([], []))
        self.picker.tick(4, False)
        self.assertIn("disconnected", self.picker.error)
        self.picker.press()
        self.picker.watch_future.set_result({"revision": "process:3"})
        self.picker.tick(5, False)
        self.picker.future.set_result(([dict(VOLUME)], []))
        self.assertTrue(self.picker.tick(6, True))

    def test_device_disappearing_before_prompt_is_not_shown(self):
        self.mounted(can_notify=False)
        self.picker.watch_future.set_result({"revision": "process:2"})
        self.picker.tick(3, False)
        self.picker.future.set_result(([], []))
        self.assertFalse(self.picker.tick(4, True))
        self.assertFalse(self.picker.active)

    def test_reply_from_previous_player_is_discarded(self):
        self.mounted()
        self.picker.turn(1)
        self.picker.press()
        self.path = "/other.sock"
        self.picker.future.set_result([{"name": "old folder", "relative_path": "old"}])
        self.picker.tick(3, False)
        self.assertEqual(self.picker.folders, [])
        self.assertEqual(self.picker.volumes, [])
        self.assertEqual(self.picker.mode, "disks")
        self.assertIn("player changed", self.picker.error)

    def test_unmounted_and_unidentified_disks_fail_without_registering(self):
        self.mounted()
        self.picker.active = False
        self.picker.open()
        self.picker.refresh = False
        self.picker.volumes = [dict(VOLUME, mount_points=[])]
        self.picker.turn(2)
        self.picker.press()
        self.assertIn("not mounted", self.picker.error)
        self.picker.error = None
        self.picker.volumes = [dict(VOLUME, uuid=None)]
        self.picker.press()
        self.assertIn("no stable UUID", self.picker.error)

    def test_watcher_failure_backs_off_and_recovery_refreshes_inventory(self):
        self.picker.tick(0, False)
        self.picker.watch_future.set_exception(OSError("player stopped"))
        self.picker.tick(1, False)
        self.assertIsNone(self.picker.watch_future)
        self.picker.tick(30, False)
        self.assertIsNone(self.picker.watch_future)
        self.picker.tick(31, False)
        self.picker.watch_future.set_result({"revision": "process:1"})
        self.picker.tick(32, False)
        self.assertEqual(self.picker.operation, "inventory")

    def test_close_cancels_pending_tasks(self):
        self.picker.tick(0, False)
        pending = self.picker.watch_future
        self.picker.close()
        self.assertTrue(pending.cancelled())
        self.assertTrue(self.picker.cancelled.is_set())
        self.assertEqual(self.worker.closed, {"wait": False, "cancel_futures": True})

    def test_readonly_requires_confirmation_then_runs_local_helper(self):
        self.mounted()
        self.picker.turn(4)
        self.picker.press()
        self.assertEqual(self.picker.mode, "readonly-confirm")
        self.assertIsNone(self.picker.future)
        self.assertEqual(self.picker.selected, 0)
        self.picker.turn(1)
        self.picker.press()
        function, args, future = self.worker.calls[-1]
        self.assertIs(function, storage.make_read_only)
        self.assertEqual(args, (VOLUME,))
        future.set_result({"read_only": True, "persistent": True})
        self.picker.tick(3, False)
        self.assertEqual(self.picker.mode, "readonly-done")

    def test_readonly_cancel_does_not_call_helper(self):
        self.mounted()
        self.picker.turn(4)
        self.picker.press()
        self.picker.press()
        self.assertEqual(self.picker.mode, "disks")
        self.assertFalse(any(fn is storage.make_read_only for fn, _, _ in self.worker.calls))

    def open_data_dir(self):
        self.mounted()
        self.picker.turn(2)
        self.picker.press()
        self.assertEqual(self.worker.calls[-1][1][1], "library_browse_volume")
        self.picker.future.set_result([{"name": "albums", "relative_path": "albums"}])
        self.picker.tick(3, False)
        self.assertEqual(self.picker.mode, "datadir")

    def test_data_dir_defaults_to_a_new_folder_and_offers_root_last(self):
        self.open_data_dir()
        self.assertEqual(self.picker.entries(), ["new folder: freqhole", "back", "albums", "use disk root"])
        self.assertEqual(self.picker.lines()[1], "> new folder: freqhole")
        self.picker.press()
        _, args, _ = self.worker.calls[-1]
        self.assertEqual(args[1:], ("storage_data_dir_preview", {
            "selection": {"device_path": "/dev/sda1", "mount_path": "/media/music",
                          "relative_path": "", "domain": "both"},
            "create_folder": "freqhole",
        }))

    def test_data_dir_subfolder_preview_confirm_schedules_and_requests_restart(self):
        self.open_data_dir()
        self.picker.turn(2)
        self.picker.press()
        self.picker.future.set_result([])
        self.picker.tick(4, False)
        self.assertEqual(self.picker.entries(), ["new folder: freqhole", "use this folder", "parent folder"])
        self.picker.turn(1)
        self.picker.press()
        args = self.worker.calls[-1][1][2]
        self.assertEqual(args["selection"]["relative_path"], "albums")
        self.assertIsNone(args["create_folder"])
        self.picker.future.set_result({"files": 12, "bytes": 3 * 1024 * 1024,
                                       "blockers": [], "collisions": [], "blocked_reason": None})
        self.picker.tick(5, False)
        self.assertEqual(self.picker.mode, "datadir-confirm")
        self.assertEqual(self.picker.lines(), ["move data here?", "12 files 3.0MB", "> cancel", "  move + restart"])
        self.picker.turn(1)
        self.picker.press()
        self.assertEqual(self.worker.calls[-1][1][1:], ("storage_data_dir_schedule", args))
        self.assertFalse(self.picker.restart_player)
        self.picker.future.set_result({"files": 12})
        self.picker.tick(6, False)
        self.assertEqual(self.picker.mode, "datadir-done")
        self.assertTrue(self.picker.restart_player)

    def test_data_dir_cancel_and_blocked_preview_do_not_schedule(self):
        self.open_data_dir()
        self.picker.press()
        self.picker.future.set_result({"files": 1, "bytes": 1, "blockers": [], "collisions": [],
                                       "blocked_reason": None})
        self.picker.tick(4, False)
        self.picker.press()
        self.assertEqual(self.picker.mode, "datadir")
        self.picker.press()
        self.picker.future.set_result({"files": 1, "bytes": 1, "blockers": [], "collisions": [],
                                       "blocked_reason": "destination is not writable: denied"})
        self.picker.tick(5, False)
        self.assertIn("not writable", self.picker.error)
        self.assertFalse(any("storage_data_dir_schedule" in args for _, args, _ in self.worker.calls))
        self.assertFalse(self.picker.restart_player)

    def test_data_dir_back_returns_to_notice(self):
        self.open_data_dir()
        self.picker.turn(1)
        self.picker.press()
        self.assertEqual(self.picker.mode, "notice")
        self.assertEqual(self.picker.entries()[self.picker.selected], "use as data dir")


class WireTests(unittest.TestCase):
    def test_cancelled_request_stops_without_connecting(self):
        cancelled = threading.Event()
        cancelled.set()
        with patch.object(storage.socket, "socket") as connection:
            with self.assertRaisesRegex(OSError, "cancelled"):
                storage.request("/player", "watch", cancelled=cancelled)
            connection.assert_not_called()

    def test_close_interrupts_an_inflight_notification_wait(self):
        cancelled = threading.Event()
        connection = MagicMock()
        connection.__enter__.return_value = connection

        def receive(_size):
            cancelled.set()
            raise socket.timeout()

        connection.recv.side_effect = receive
        with patch.object(storage.socket, "socket", return_value=connection):
            with self.assertRaisesRegex(OSError, "cancelled"):
                storage.request("/player", "watch", cancelled=cancelled)
        connection.settimeout.assert_any_call(0.5)
        connection.__exit__.assert_called_once()

    def exchange(self, chunks, command="library_list_sources"):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "storage.sock")
            listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            listener.bind(path)
            listener.listen(1)
            received = []
            failures = []

            def serve():
                try:
                    with listener:
                        connection, _ = listener.accept()
                        with connection:
                            connection.settimeout(2)
                            message = bytearray()
                            while b"\n" not in message:
                                message.extend(connection.recv(4096))
                            received.append(bytes(message))
                            for chunk in chunks:
                                connection.sendall(chunk)
                except OSError as error:
                    failures.append(error)

            thread = threading.Thread(target=serve)
            thread.start()
            try:
                return storage.request(path, command), received
            finally:
                thread.join(timeout=3)
                self.assertFalse(thread.is_alive())
                self.assertFalse(failures)

    def test_chunked_newline_reply_and_request_envelope(self):
        result, received = self.exchange([b'{"success":true,', b'"data":[]}\n'])
        self.assertEqual(result, [])
        prefix, payload = received[0].decode().split(" ", 1)
        self.assertEqual(prefix, "library_storage")
        self.assertEqual(json.loads(payload), {"command": "library_list_sources", "args": {}})

    def test_malformed_failed_missing_and_truncated_replies_are_errors(self):
        for reply in [
            b'{"success":false,"errors":[{"detail":"disk gone"}]}\n',
            b'{"success":false,"errors":[1]}\n', b'null\n',
            b'{"success":true}\n', b'not JSON\n', b'{"success":true',
        ]:
            with self.subTest(reply=reply), self.assertRaises(ValueError):
                self.exchange([reply])

    def test_total_deadline_is_not_reset_by_partial_reads(self):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.recv.return_value = b"{"
        with patch.object(storage.socket, "socket", return_value=connection), patch.object(
            storage.time, "monotonic", side_effect=[0, 10, 31]
        ):
            with self.assertRaises(TimeoutError):
                storage.request("/player", "library_list_sources")
        connection.settimeout.assert_any_call(20)


class MenuIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.worker = Worker()
        self.patches = [
            patch.object(menu, "ThreadPoolExecutor", return_value=self.worker),
            patch.object(storage, "ThreadPoolExecutor", return_value=self.worker),
        ]
        for patched in self.patches:
            patched.start()
            self.addCleanup(patched.stop)
        oled = MagicMock(width=128)
        self.screen = menu.Menu(oled, MagicMock(), 0)
        self.addCleanup(self.screen.close)
        for name in ("poll_command", "poll_state", "poll_network", "poll_wifi", "poll_updates"):
            patched = patch.object(self.screen, name)
            patched.start()
            self.addCleanup(patched.stop)

    def notice(self):
        picker = self.screen.storage
        picker.tick(0, False)
        picker.watch_future.set_result({"revision": "process:1"})
        picker.tick(1, False)
        picker.future.set_result(([dict(VOLUME)], []))

    def test_mount_wakes_sleeping_display_and_turn_selects_actions(self):
        self.screen.asleep = True
        self.notice()
        self.screen.tick(40, 0, False)
        self.assertFalse(self.screen.asleep)
        self.assertEqual(self.screen.screen, "storage")
        self.screen.tick(41, 1, False)
        self.assertEqual(self.screen.storage.selected, 1)
        self.screen.tick(400, 0, False)
        self.assertIsNone(self.screen.sleep_started)

    def test_mount_does_not_interrupt_shutdown_confirmation(self):
        self.screen.screen = "confirm"
        self.screen.last_activity = 10
        self.notice()
        self.screen.tick(11, 0, False)
        self.assertEqual(self.screen.screen, "confirm")
        self.assertFalse(self.screen.storage.active)
        self.screen.screen = "menu"
        self.screen.tick(12, 0, False)
        self.assertEqual(self.screen.screen, "storage")

    def rendered(self):
        self.screen.oled.text.reset_mock()
        self.screen.dirty = True
        self.screen.render()
        return [call.args[0] for call in self.screen.oled.text.call_args_list]

    def test_wake_sensitivity_screen_marks_current_option_and_wheel_stops_at_exit(self):
        with patch.object(menu, "WAKE_ENCODER_CLICKS", 2):
            self.screen.screen = "wake"
            self.screen.wake_selected = 1
            self.assertEqual(self.rendered(), ["wake sensitivity", "   1 click", "> *2 clicks", "   3 clicks"])
            self.screen.tick(1, 10, False)
            self.assertEqual(self.screen.wake_selected, len(menu.WAKE_CLICK_OPTIONS))
            self.assertEqual(self.rendered(), ["wake sensitivity", "   3 clicks", "   button only", ">  exit"])
            self.screen.tick(2, -10, False)
            self.assertEqual(self.screen.wake_selected, 0)

    def test_queued_data_move_restarts_the_player(self):
        self.screen.screen = "storage"
        self.screen.storage.active = True
        self.screen.storage.restart_player = True
        with patch.object(self.screen, "start_command") as start:
            self.screen.tick(5, 0, False)
        start.assert_called_once_with(menu.DATA_MOVE_LABEL, menu.PLAYER_RESTART)
        self.assertFalse(self.screen.storage.restart_player)
        self.assertFalse(self.screen.storage.active)


if __name__ == "__main__":
    unittest.main()
